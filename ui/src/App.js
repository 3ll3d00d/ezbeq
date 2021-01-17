import React, {useEffect, useState} from 'react';
import {SelectValue} from "./components/Filter";
import {useValueChange} from "./components/valueState";
import {createMuiTheme, fade, makeStyles, ThemeProvider} from '@material-ui/core/styles';
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
import useMediaQuery from '@material-ui/core/useMediaQuery';
import CssBaseline from '@material-ui/core/CssBaseline';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        width: '100wh',
        height: '100vh',
        '& > *': {
            margin: theme.spacing(1),
        }
    },
    noLeft: {
        marginLeft: '0px'
    },
    noLeftTop: {
        marginLeft: '0px',
        marginTop: '0px'
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
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const theme = React.useMemo(
        () =>
            createMuiTheme({
                palette: {
                    type: prefersDarkMode ? 'dark' : 'light',
                },
            }),
        [prefersDarkMode],
    );

    const classes = useStyles();
    // catalogue data
    const [entries, setEntries] = useState([]);
    const [authors, setAuthors] = useState([]);
    const [years, setYears] = useState([]);
    const [audioTypes, setAudioTypes] = useState([]);
    const [meta, setMeta] = useState({});
    // filtered catalogue data
    const [filteredEntries, setFilteredEntries] = useState([]);
    const [filteredYears, setFilteredYears] = useState([]);
    const [filteredAudioTypes, setFilteredAudioTypes] = useState([]);
    // minidsp data
    const [minidspConfigSlots, setMinidspConfigSlots] = useState([]);
    // user selections
    const [selectedAuthors, handleAuthorChange] = useValueChange()
    const [selectedYears, handleYearChange] = useValueChange()
    const [selectedAudioTypes, handleAudioTypeChange] = useValueChange()
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
        pushData(setMeta, ezbeq.getMeta);
    }, []);

    useEffect(() => {
        pushData(setMinidspConfigSlots, ezbeq.getMinidspConfig);
    }, []);

    useEffect(() => {
        pushData(setAuthors, ezbeq.getAuthors);
    }, []);

    useEffect(() => {
        pushData(setYears, ezbeq.getYears);
    }, []);

    useEffect(() => {
        pushData(setAudioTypes, ezbeq.getAudioTypes);
    }, []);

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

    useEffect(() => {
        pushData(setFilteredYears, () => [...new Set(filteredEntries.map(e => e.year))]);
        pushData(setFilteredAudioTypes, () => [...new Set(filteredEntries.map(e => e.audioTypes).flat())]);
    }, [filteredEntries]);

    const sendToDevice = async (entryId, slotId) => {
        const selected = filteredEntries.find(e => e.id === entryId);
        const vals = await ezbeq.sendFilter(selected.id, slotId);
        setMinidspConfigSlots(vals);
    }

    const clearDeviceSlot = async (slotId) => {
        const vals = await ezbeq.clearSlot(slotId);
        setMinidspConfigSlots(vals);
    }

    const activateSlot = async (slotId) => {
        const vals = await ezbeq.activateSlot(slotId);
        setMinidspConfigSlots(vals);
    }

    // grid definitions
    const minidspGridColumns = [
        {
            field: 'id',
            headerName: ' ',
            width: 25,
            valueFormatter: params => params.value + 1
        },
        {
            field: 'actions',
            headerName: 'Actions',
            width: 120,
            renderCell: params => (
                <>
                    <IconButton aria-label={'send'}
                                disabled={selectedEntryId === -1}
                                onClick={() => sendToDevice(selectedEntryId, params.row.id)}
                                color="primary"
                                edge={'start'}>
                        <CloudUploadIcon/>
                    </IconButton>
                    <IconButton aria-label={'activate'}
                                onClick={() => activateSlot(params.row.id)}
                                color="primary"
                                edge={'start'}>
                        <PlayArrowIcon/>
                    </IconButton>
                    <IconButton aria-label={'clear'}
                                onClick={() => clearDeviceSlot(params.row.id)}
                                color="primary"
                                edge={'start'}>
                        <ClearIcon/>
                    </IconButton>
                </>
            )
        },
        {
            field: 'last',
            headerName: 'Loaded',
            flex: 0.45,
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
    const padZero = n => n.toString().padStart(2, '0');
    const formatSeconds = s => {
        if (s) {
            const d = new Date(0);
            d.setUTCSeconds(s);
            return `${d.getFullYear()}${padZero(d.getMonth()+1)}${padZero(d.getDate())}_${padZero(d.getHours())}${padZero(d.getMinutes())}${padZero(d.getSeconds())}`
        }
        return '?';
    }


    return (
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <div className={classes.root}>
                <AppBar position="static" className={classes.noLeftTop}>
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
                        <Grid container className={classes.noLeft}>
                            <Grid item>
                                <SelectValue name="Author"
                                             value={selectedAuthors}
                                             handleValueChange={handleAuthorChange}
                                             values={authors}
                                             isInView={v => true}/>
                                <SelectValue name="Year"
                                             value={selectedYears}
                                             handleValueChange={handleYearChange}
                                             values={years}
                                             isInView={v => filteredYears.length === 0 || filteredYears.indexOf(v) > -1}/>
                                <SelectValue name="Audio Type"
                                             value={selectedAudioTypes}
                                             handleValueChange={handleAudioTypeChange}
                                             values={audioTypes}
                                             isInView={v => filteredAudioTypes.length === 0 || filteredAudioTypes.indexOf(v) > -1}/>
                            </Grid>
                        </Grid>
                        : null
                }
                <Grid container direction={'column'} className={classes.noLeft}>
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
                        <Grid container className={classes.noLeft}>
                            <Grid item style={{height: `${window.innerHeight - 306}px`, width: '100%'}}>
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
                {
                    meta
                    ?
                        <Grid container justify="center" className={classes.noLeft}>
                            <Grid item>
                                <Typography align={'center'} variant={'caption'} color={'textSecondary'}>
                                    BEQCatalogue: {formatSeconds(meta.created)}
                                </Typography>
                            </Grid>
                        </Grid>
                    : null
                }
            </div>
        </ThemeProvider>
    );
};

export default App;