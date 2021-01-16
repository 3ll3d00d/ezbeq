import React, {useEffect, useState} from 'react';
import {SelectValue} from "./components/Filter";
import {useValueChange} from "./components/valueState";
import {fade, makeStyles} from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import {DataGrid} from '@material-ui/data-grid';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import {Avatar, FormControlLabel, Grid, IconButton, InputBase, Switch} from "@material-ui/core";
import SearchIcon from '@material-ui/icons/Search';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import ClearIcon from '@material-ui/icons/Clear';
import beqcIcon from './beqc.png'
import ezbeq from './services/ezbeq';

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        minHeight: '100vh',
        '& > *': {
            margin: theme.spacing(1),
        }
    },
    title: {
        flexGrow: 1,
        marginLeft: theme.spacing(1)
    },
    search: {
        position: 'relative',
        borderRadius: theme.shape.borderRadius,
        backgroundColor: fade(theme.palette.common.white, 0.15),
        '&:hover': {
            backgroundColor: fade(theme.palette.common.white, 0.25),
        },
        marginLeft: 0,
        width: '50%',
        [theme.breakpoints.up('sm')]: {
            marginLeft: theme.spacing(1),
            width: 'auto',
        },
    },
    searchIcon: {
        padding: theme.spacing(0, 2),
        height: '100%',
        position: 'absolute',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputRoot: {
        color: 'inherit',
    },
    inputInput: {
        padding: theme.spacing(1, 1, 1, 0),
        // vertical padding + font size from searchIcon
        paddingLeft: `calc(1em + ${theme.spacing(4)}px)`,
        transition: theme.transitions.create('width'),
        width: '100%',
        [theme.breakpoints.up('sm')]: {
            width: '12ch',
            '&:focus': {
                width: '20ch',
            },
        },
    },
    advancedFilter: {
        marginLeft: '4px',
        marginRight: '0px'
    },
    smallAvatar: {
        width: theme.spacing(3),
        height: theme.spacing(3),
    }
}));

const App = () => {
    const classes = useStyles();
    // catalogue data
    const [entries, setEntries] = useState([]);
    const [authors, setAuthors] = useState([]);
    const [years, setYears] = useState([]);
    const [audioTypes, setAudioTypes] = useState([]);
    // filtered catalogue data
    const [filteredEntries, setFilteredEntries] = useState([]);
    const [filteredAuthors, setFilteredAuthors] = useState([]);
    const [filteredYears, setFilteredYears] = useState([]);
    const [filteredContentTypes, setFilteredContentTypes] = useState([]);
    // minidsp data
    const [minidspConfigSlots, setMinidspConfigSlots] = useState([]);
    // user selections
    const [txtFilter, handleTxtFilterChange] = useValueChange('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedEntryId, setSelectedEntryId] = useState(-1);

    const toggleShowFilters = () => {
        setShowFilters((prev) => !prev);
    };

    const pushData = async (setter, getter) => {
        const data = await getter();
        setter(data);
    };

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load);
    }, []);

    useEffect(() => {
        pushData(setMinidspConfigSlots, ezbeq.getMinidspConfig);
    }, []);

    useEffect(() => {
        pushData(setAuthors, ezbeq.getAuthors);
    }, []);
    const [selectedAuthors, handleAuthorChange] = useValueChange()

    useEffect(() => {
        pushData(setYears, ezbeq.getYears);
    }, []);
    const [selectedYears, handleYearChange] = useValueChange()

    useEffect(() => {
        pushData(setAudioTypes, ezbeq.getAudioTypes);
    }, []);
    const [selectedAudioTypes, handleAudioTypeChange] = useValueChange()

    useEffect(() => {
        // catalogue filter
        const isMatch = (entry) => {
            if (!selectedAuthors.length || selectedAuthors.indexOf(entry.author) > -1) {
                if (!selectedYears.length || selectedYears.indexOf(entry.year) > -1) {
                    if (!selectedAudioTypes.length || entry.audioTypes.some(at => selectedAudioTypes.indexOf(at) > -1)) {
                        if (!txtFilter || entry.title.toLowerCase().includes(txtFilter.toLowerCase())) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }
        pushData(setFilteredEntries, () => entries.filter(isMatch));
    }, [entries, selectedAudioTypes, selectedYears, selectedAuthors, txtFilter]);

    const sendToDevice = async (entryId, slotId) => {
        const selected = filteredEntries.find(e => e.id === entryId);
        const vals = await ezbeq.sendFilter(selected.id, slotId);
        setMinidspConfigSlots(vals);
    }

    const clearDeviceSlot = async (slotId) => {
        const vals = await ezbeq.clearSlot(slotId);
        setMinidspConfigSlots(vals);
    }

    // grid definitions
    const minidspGridColumns = [
        {
            field: 'id',
            headerName: ' ',
            flex: 0.12,
            valueFormatter: params => params.value + 1
        },
        {
            field: 'last',
            headerName: 'Loaded',
            flex: 0.45,
        },
        {
            field: 'actions',
            headerName: 'Actions',
            flex: 0.33,
            renderCell: params => (
                <>
                    <IconButton aria-label={'send'}
                                disabled={selectedEntryId === -1}
                                onClick={() => sendToDevice(selectedEntryId, params.row.id)}
                                color="primary">
                        <CloudUploadIcon/>
                    </IconButton>
                    <IconButton aria-label={'clear'}
                                onClick={() => clearDeviceSlot(params.row.id)}
                                color="primary">
                        <ClearIcon/>
                    </IconButton>
                </>
            )
        }
    ];
    const catalogueGridColumns = [
        {
            field: 'title',
            headerName: 'Title',
            flex: 0.6,
            renderCell: params => (
                params.row.url
                    ? <a href={params.row.url} target='_beq'>{params.value}</a>
                    : params.value
            )
        },
        {
            field: 'audioTypes',
            headerName: 'Audio Type',
            flex: 0.4
        }
    ];

    return (
        <div className={classes.root}>
            <AppBar position="static">
                <Toolbar>
                    <Avatar alt="beqcatalogue"
                            variant="rounded"
                            src={beqcIcon}
                            className={classes.smallAvatar}/>
                    <Typography className={classes.title} variant="h6" noWrap>ezbeq</Typography>
                    <div className={classes.search}>
                        <div className={classes.searchIcon}>
                            <SearchIcon/>
                        </div>
                        <InputBase
                            placeholder="Search…"
                            classes={{
                                root: classes.inputRoot,
                                input: classes.inputInput,
                            }}
                            inputProps={{'aria-label': 'search'}}
                            value={txtFilter}
                            onChange={handleTxtFilterChange}
                            size={'small'}
                        />
                    </div>
                    <FormControlLabel className={classes.advancedFilter}
                                      control={<Switch checked={showFilters} onChange={toggleShowFilters}
                                                       size={'small'}/>}
                    />
                </Toolbar>
            </AppBar>
            {
                showFilters
                    ?
                    <Grid container>
                        <Grid item>
                            <SelectValue name="Author"
                                         value={selectedAuthors}
                                         handleValueChange={handleAuthorChange}
                                         values={authors}/>
                            <SelectValue name="Year"
                                         value={selectedYears}
                                         handleValueChange={handleYearChange}
                                         values={years}/>
                            <SelectValue name="Audio Type"
                                         value={selectedAudioTypes}
                                         handleValueChange={handleAudioTypeChange}
                                         values={audioTypes}/>
                        </Grid>
                    </Grid>
                    : null
            }
            <Grid container direction={'column'}>
                <Grid item style={{height: '190px', width: '100%'}}>
                    <DataGrid rows={minidspConfigSlots}
                              columns={minidspGridColumns}
                              autoPageSize
                              hideFooter
                              density={'compact'}/>
                </Grid>
            </Grid>
            {
                filteredEntries.length
                    ?
                    <Grid container>
                        <Grid item style={{minHeight: '60vh', width: '100%'}}>
                            <DataGrid rows={filteredEntries}
                                      columns={catalogueGridColumns}
                                      pageSize={100}
                                      density={'compact'}
                                      sortModel={[
                                          {
                                              field: 'title',
                                              sort: 'asc',
                                          },
                                      ]}
                                      onRowSelected={p => setSelectedEntryId(p.data.id)}
                            />
                        </Grid>
                    </Grid>
                    : null
            }
        </div>
    );
};

export default App;