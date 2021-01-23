import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import {Avatar, FormControlLabel, InputBase, Switch} from "@material-ui/core";
import beqcIcon from "../beqc.png";
import Typography from "@material-ui/core/Typography";
import SearchIcon from "@material-ui/icons/Search";
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
    smallAvatar: {
        width: theme.spacing(3),
        height: theme.spacing(3),
    },
    advancedFilter: {
        marginLeft: '4px',
        marginRight: '0px'
    }
}));

const Header = ({txtFilter, handleTxtFilterChange, showFilters, toggleShowFilters}) => {
    const classes = useStyles();
    return (
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
                                  control={
                                      <Switch checked={showFilters} onChange={toggleShowFilters} size={'small'}/>
                                  }/>
            </Toolbar>
        </AppBar>
    );
};

export default Header;