import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import {Avatar, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip} from "@mui/material";
import beqcIcon from "../beqc.png";
import React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import MenuIcon from '@mui/icons-material/Menu';
import LocalLibraryIcon from "@mui/icons-material/LocalLibrary";
import EqualizerIcon from "@mui/icons-material/Equalizer";
import SettingsApplicationsIcon from "@mui/icons-material/SettingsApplications";
import {Check} from "@mui/icons-material";

const Header = ({
                    availableDeviceNames,
                    setSelectedDeviceName,
                    selectedDeviceName,
                    selectedNav,
                    setSelectedNav,
                    hasMultipleTabs,
                    children
                }) => {
    const mobileMenuId = 'mobile-menu';
    const [mobileMoreAnchorEl, setMobileMoreAnchorEl] = React.useState(null);
    const isMobileMenuOpen = Boolean(mobileMoreAnchorEl);
    const handleMobileMenuClose = () => {
        setMobileMoreAnchorEl(null);
    };
    const handleMobileMenuOpen = (event) => {
        setMobileMoreAnchorEl(event.currentTarget);
    };

    const mainMenuId = 'main-menu';
    const [mainMenuAnchorEl, setMainMenuAnchorEl] = React.useState(null);
    const mainMenuOpen = Boolean(mainMenuAnchorEl);
    const openMainMenu = (event) => {
        setMainMenuAnchorEl(event.currentTarget);
    };
    const closeMainMenu = () => {
        setMainMenuAnchorEl(null);
    };
    const tabNames = hasMultipleTabs ? ['Catalogue', 'Levels', 'Control'] : [];
    const tabIcons = {
        'Catalogue': <LocalLibraryIcon/>,
        'Levels': <EqualizerIcon/>,
        'Control': <SettingsApplicationsIcon/>
    }
    const navMenuItems = tabNames.map(t =>
        <MenuItem key={t} onClick={e => setSelectedNav(t.toLowerCase())}>
            {selectedNav === t.toLowerCase() ? <ListItemIcon><Check/></ListItemIcon> : null}
            <ListItemText inset={selectedNav !== t.toLowerCase()}>{t}</ListItemText>{tabIcons[t]}
        </MenuItem>
    );
    const deviceMenuItems = availableDeviceNames.map(d =>
        <MenuItem value={d}
                  key={d}
                  onClick={e => setSelectedDeviceName(d)}>
            {d === selectedDeviceName ? <ListItemIcon><Check/></ListItemIcon> : null}
            <ListItemText inset={d !== selectedDeviceName}>{d}</ListItemText>
        </MenuItem>
    );

    const renderMobileMenu = (
        <Menu id={mobileMenuId}
              anchorEl={mobileMoreAnchorEl}
              anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
              }}
              keepMounted
              transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
              }}
              open={isMobileMenuOpen}
              onClose={handleMobileMenuClose}>
            {navMenuItems}
            {deviceMenuItems ? <Divider/> : null}
            {deviceMenuItems}
        </Menu>
    );

    const renderMainMenu = (
        <Menu id="main-menu"
              anchorEl={mainMenuAnchorEl}
              open={mainMenuOpen}
              onClose={closeMainMenu}
              onClick={closeMainMenu}
              PaperProps={{
                  elevation: 0,
                  sx: {
                      overflow: 'visible',
                      filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                      mt: 1.5,
                      '& .MuiAvatar-root': {
                          width: 32,
                          height: 32,
                          ml: -0.5,
                          mr: 1,
                      },
                      '&:before': {
                          content: '""',
                          display: 'block',
                          position: 'absolute',
                          top: 0,
                          right: 14,
                          width: 10,
                          height: 10,
                          bgcolor: 'background.paper',
                          transform: 'translateY(-50%) rotate(45deg)',
                          zIndex: 0,
                      },
                  },
              }}
              transformOrigin={{horizontal: 'right', vertical: 'top'}}
              anchorOrigin={{horizontal: 'right', vertical: 'bottom'}}
        >
            {navMenuItems}
            {deviceMenuItems ? <Divider/> : null}
            {deviceMenuItems}
        </Menu>
    );

    const shouldShowMenu = availableDeviceNames.length > 1 || hasMultipleTabs;

    return (
        <Box sx={{flexGrow: 1}}>
            <AppBar position="static" sx={{marginLeft: '0px', marginTop: '0px'}}>
                <Toolbar>
                    <Avatar alt="beqcatalogue"
                            variant="rounded"
                            src={beqcIcon}
                            sx={{width: 32, height: 32}}/>
                    <Box sx={{flexGrow: 1}}/>
                    {children}
                    <Box sx={{display: {xs: 'none', md: 'flex'}}}>
                        {
                            shouldShowMenu
                                ?
                                <IconButton
                                    onClick={openMainMenu}
                                    size="small"
                                    sx={{ml: 2}}
                                    aria-controls={mainMenuOpen ? 'device-menu' : undefined}
                                    aria-haspopup="true"
                                    aria-expanded={mainMenuOpen ? 'true' : undefined}
                                >
                                    <MenuIcon/>
                                </IconButton>
                                :
                                null
                        }
                    </Box>
                    <Box sx={{display: {xs: 'flex', md: 'none'}}}>
                        {
                            shouldShowMenu
                                ?
                                <IconButton
                                    size="large"
                                    aria-label="show more"
                                    aria-controls={mobileMenuId}
                                    aria-haspopup="true"
                                    onClick={handleMobileMenuOpen}>
                                    <MenuIcon/>
                                </IconButton>
                                : null
                        }
                    </Box>
                </Toolbar>
            </AppBar>
            {renderMobileMenu}
            {renderMainMenu}
        </Box>
    );
};

export default Header;