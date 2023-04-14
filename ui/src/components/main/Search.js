import SearchIcon from "@mui/icons-material/Search";
import {FormControlLabel, IconButton, InputBase, Switch} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import React from "react";
import {makeStyles} from "@mui/styles";
import {alpha} from "@mui/material/styles";

const useStyles = makeStyles((theme) => ({
    search: {
        position: 'relative',
        borderRadius: theme.shape.borderRadius,
        backgroundColor: alpha(theme.palette.common.white, 0.15),
        '&:hover': {
            backgroundColor: alpha(theme.palette.common.white, 0.25),
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
        paddingLeft: `calc(1em + ${theme.spacing(4)})`
    },
    advancedFilter: {
        marginLeft: '4px',
        marginRight: '0px'
    }
}));

const Search = ({txtFilter, setTxtFilter, showFilters, toggleShowFilters}) => {
    const classes = useStyles();
    return <>
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
                fullWidth={true}
            />
        </div>
        <IconButton onClick={e => setTxtFilter("")} size="large">
            <ClearIcon/>
        </IconButton>
        <FormControlLabel className={classes.advancedFilter}
                          control={
                              <Switch checked={showFilters} onChange={toggleShowFilters} size={'small'} color="default"/>
                          }/>
    </>;
};
export default Search;