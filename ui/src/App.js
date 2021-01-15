import React, {useEffect, useState} from 'react';
import {SelectValue, EnterValue} from "./components/Filter";
import {useValueChange} from "./components/valueState";
import {makeStyles} from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import {DataGrid} from '@material-ui/data-grid';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import {Button, Grid} from "@material-ui/core";
import ezbeq from './services/ezbeq';

const useStyles = makeStyles((theme) => ({
    root: {
        flexGrow: 1,
        '& > *': {
            margin: theme.spacing(1),
        }
    },
    menuButton: {
        marginRight: theme.spacing(2),
    },
    title: {
        flexGrow: 1,
    },
}));

const App = () => {
    const classes = useStyles();
    // raw data for filters
    const [minidspConfigSlots, setMinidspConfigSlots] = useState([...Array(4).keys()].map(i => `Slot ${i + 1}`));
    const [authors, setAuthors] = useState([]);
    const [years, setYears] = useState([]);
    const [audioTypes, setAudioTypes] = useState([]);
    // catalogue data
    const [entries, setEntries] = useState([]);
    const [filteredEntries, setFilteredEntries] = useState([]);
    // user selections
    const [txtFilter, handleTxtFilterChange] = useValueChange('')
    const [selectedSlot, handleSlotChange] = useValueChange('Slot 1')

    const pushData = async (setter, getter) => {
        const data = await getter();
        setter(data);
    };

    // initial data load
    useEffect(() => {
        pushData(setEntries, ezbeq.load);
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

    useEffect(() => {
        pushData(setFilteredEntries, () => entries.filter(isMatch));
    }, [selectedAudioTypes, selectedYears, selectedAuthors, txtFilter]);

    const sendToDevice = async (id) => {
        const selected = filteredEntries.find(e => e.id === id);
        await ezbeq.send(selected.id, selectedSlot.slice(-1));
    }

    // grid definition
    const gridColumns = [
        {
            field: 'title',
            headerName: 'Title',
            flex: 0.5,
            renderCell: params => (
                <a href={params.row.url} target='_beq'>{params.value}</a>
            )
        },
        {
            field: 'audioTypes',
            headerName: 'Audio Type',
            flex: 0.3
        },
        {
            field: 'select',
            headerName: ' ',
            flex: 0.2,
            sortable: false,
            renderCell: params => (
                <Button variant="contained"
                        color="primary"
                        size="small"
                        onClick={() => sendToDevice(params.row.id)}>
                    Send
                </Button>
            )
        }
    ];

    return (
        <div className={classes.root}>
            <AppBar position="static">
                <Toolbar>
                    <SelectValue name="Slot"
                                 value={selectedSlot}
                                 handleValueChange={handleSlotChange}
                                 values={minidspConfigSlots}
                                 multi={false}/>
                    <Typography variant="h6" className={classes.title} align={'center'}>
                        ezbeq
                    </Typography>
                </Toolbar>
            </AppBar>
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
                    <EnterValue name="Title"
                                 value={txtFilter}
                                 handleValueChange={handleTxtFilterChange}/>
                </Grid>
            </Grid>
            {
                filteredEntries.length
                ?
                    <Grid container>
                        <Grid item style={{height: '600px', width: '100%'}}>
                            <DataGrid rows={filteredEntries}
                                      columns={gridColumns}
                                      pageSize={100}
                                      density={'compact'}
                                      sortModel={[
                                          {
                                              field: 'title',
                                              sort: 'asc',
                                          },
                                      ]}
                            />
                        </Grid>
                    </Grid>
                : null
            }
        </div>
    );
};

export default App;