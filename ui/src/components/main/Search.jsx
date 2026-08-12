import {alpha, styled} from '@mui/material/styles';
import SearchIcon from "@mui/icons-material/Search";
import {IconButton, InputBase, Switch} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import React from "react";

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
    // Below `sm`, the header has no room to spare - the two spacer Boxes either side of this in
    // Header.jsx already stop growing at that point (see their own xs override), so this claims
    // that freed space instead of shrinking to its unconstrained natural width, which is how the
    // search box collapsed to almost nothing on a phone in the first place (see the "crowded
    // search bar" bug report - a Galaxy S23 screenshot showed the input squeezed to a sliver by
    // the other toolbar icons). minWidth: 0 overrides flexbox's default min-width:auto so it can
    // still shrink below that if the row is ever tighter than the icons alone allow, rather than
    // forcing horizontal overflow on the AppBar.
    flexGrow: 1,
    minWidth: 0,
    [theme.breakpoints.up('sm')]: {
        marginLeft: theme.spacing(3),
        width: 'auto',
        flexGrow: 0,
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
        {
            // Only takes up toolbar space once there's actually something to clear - on a phone
            // this button sat there unusable (nothing to clear on an empty search) while eating
            // ~48px the input desperately needed.
            txtFilter
                ? <IconButton onClick={e => setTxtFilter("")} size="small" aria-label="clear search">
                    <ClearIcon/>
                </IconButton>
                : null
        }
        <Switch checked={showFilters}
                onChange={toggleShowFilters}
                size="small"
                color="default"
                sx={{marginLeft: '4px'}}
                slotProps={{input: {'aria-label': 'show filters'}}}/>
    </>;
};
export default Search;