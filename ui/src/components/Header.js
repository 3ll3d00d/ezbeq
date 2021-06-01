import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import {
    Avatar,
    FormControl,
    FormControlLabel,
    IconButton,
    InputBase,
    MenuItem,
    Select,
    Switch
} from "@material-ui/core";
import beqcIcon from "../beqc.png";
import Typography from "@material-ui/core/Typography";
import SearchIcon from "@material-ui/icons/Search";
import ClearIcon from "@material-ui/icons/Clear";
import React from "react";
import {fade, makeStyles} from "@material-ui/core/styles";

const useStyles = makeStyles((theme) => ({
    noLeftTop: {
        marginLeft: '0px',
        marginTop: '0px'
    },
    title: {
        flexGrow: 1,
        marginLeft: theme.spacing(1)
    },
    device: {
        flexGrow: 1,
        margin: theme.spacing(1),
        [theme.breakpoints.down('sm')]: {
            flexGrow: 0.5
        },
    },
    search: {
        position: 'relative',
        borderRadius: theme.shape.borderRadius,
        backgroundColor: fade(theme.palette.common.white, 0.15),
        '&:hover': {
            backgroundColor: fade(theme.palette.common.white, 0.25),
        },
        width: '40%',
        [theme.breakpoints.up('md')]: {
            flexGrow: 1
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
    smallAvatar: {
        width: theme.spacing(3),
        height: theme.spacing(3),
    },
    advancedFilter: {
        marginLeft: '4px',
        marginRight: '0px'
    }
}));

const Header = ({
                    txtFilter,
                    setTxtFilter,
                    showFilters,
                    toggleShowFilters,
                    availableDeviceNames,
                    setSelectedDeviceName,
                    selectedDeviceName
                }) => {
    const classes = useStyles();
    return (
        <AppBar position="static" className={classes.noLeftTop}>
            <Toolbar>
                <Avatar alt="beqcatalogue"
                        variant="rounded"
                        src={beqcIcon}
                        className={classes.smallAvatar}/>
                {
                    availableDeviceNames.length > 1
                        ?
                        <FormControl className={classes.device}>
                            <Select labelId="device-select-label"
                                    id="device-select"
                                    value={selectedDeviceName ? selectedDeviceName : availableDeviceNames[0]}
                                    onChange={e => setSelectedDeviceName(e.target.value)}
                                    autoWidth={true}>
                                {
                                    availableDeviceNames.map(d => <MenuItem value={d} key={d}>{d}</MenuItem>)
                                }
                            </Select>
                        </FormControl>
                        :
                        (
                            !availableDeviceNames || availableDeviceNames.length === 0
                                ?
                                null
                                :
                                <Typography className={classes.title} variant="h6" noWrap>ezbeq</Typography>
                        )
                }
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
                        onChange={e => setTxtFilter(e.target.value)}
                        size={'small'}
                    />
                </div>
                <IconButton onClick={e => setTxtFilter("")}>
                    <ClearIcon/>
                </IconButton>
                <FormControlLabel className={classes.advancedFilter}
                                  control={
                                      <Switch checked={showFilters} onChange={toggleShowFilters} size={'small'}/>
                                  }/>
            </Toolbar>
        </AppBar>
    );
};

export default Header;