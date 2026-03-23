import {alpha, styled} from '@mui/material/styles';
import SearchIcon from "@mui/icons-material/Search";
import {FormControlLabel, IconButton, InputBase, Switch} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import React from "react";
import Box from "@mui/material/Box";

const SearchBar = styled('div')(({theme}) => ({
    position: 'relative',
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.common.white, 0.15),
    '&:hover': {
        backgroundColor: alpha(theme.palette.common.white, 0.25),
    },
    marginRight: theme.spacing(2),
    marginLeft: 0,
    width: 'auto',
    [theme.breakpoints.up('sm')]: {
        marginLeft: theme.spacing(3),
        width: 'auto',
    },
}));

const SearchIconWrapper = styled('div')(({theme}) => ({
    padding: theme.spacing(0, 2),
    height: '100%',
    position: 'absolute',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
}));

const StyledInputBase = styled(InputBase)(({theme}) => ({
    color: 'inherit',
    '& .MuiInputBase-input': {
        padding: theme.spacing(1, 1, 1, 0),
        // vertical padding + font size from searchIcon
        paddingLeft: `calc(1em + ${theme.spacing(4)})`,
        transition: theme.transitions.create('width'),
        width: '100%',
        [theme.breakpoints.up('sm')]: {
            width: '33ch',
        },
        [theme.breakpoints.up('md')]: {
            width: '60ch',
        },
        [theme.breakpoints.up('lg')]: {
            width: '100ch',
        },
        [theme.breakpoints.up('xl')]: {
            width: '140ch',
        }
    },
}));

const Search = ({txtFilter, setTxtFilter, showFilters, toggleShowFilters}) => {
    return <>
        <SearchBar>
            <SearchIconWrapper>
                <SearchIcon/>
            </SearchIconWrapper>
            <StyledInputBase
                placeholder="Search…"
                slotProps={{
                    input: {'aria-label': 'search'}
                }}
                value={txtFilter}
                onChange={e => setTxtFilter(e.target.value)}
                // size={'small'}
                fullWidth={true}
            />
        </SearchBar>
        <IconButton onClick={e => setTxtFilter("")} size="large">
            <ClearIcon/>
        </IconButton>
        <FormControlLabel sx={{marginLeft: '4px'}}
                          control={
                              <Switch checked={showFilters}
                                      onChange={toggleShowFilters}
                                      size={'small'}
                                      color="default"/>
                          }/>
    </>;
};
export default Search;