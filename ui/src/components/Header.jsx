import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import {Avatar, Badge, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip} from "@mui/material";
import beqcIcon from "../beqc.png";
import React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import MenuIcon from '@mui/icons-material/Menu';
import LocalLibraryIcon from "@mui/icons-material/LocalLibrary";
import EqualizerIcon from "@mui/icons-material/Equalizer";
import SettingsApplicationsIcon from "@mui/icons-material/SettingsApplications";
import NewReleasesIcon from "@mui/icons-material/NewReleases";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import {Check} from "@mui/icons-material";
import PairMobileAppDialog from "./PairMobileAppDialog";

const Header = ({
                    availableDevices,
                    setSelectedDeviceName,
                    selectedDeviceName,
                    selectedNav,
                    setSelectedNav,
                    whatsNewCount,
                    onWhatsNewOpen,
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

    const [pairDialogOpen, setPairDialogOpen] = React.useState(false);
    const openWhatsNewFromMenu = () => {
        handleMobileMenuClose();
        onWhatsNewOpen();
    };
    const openPairDialogFromMenu = () => {
        handleMobileMenuClose();
        setPairDialogOpen(true);
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
    const tabNames = ['Catalogue'];
    if (selectedDeviceName && availableDevices && (availableDevices[selectedDeviceName].type === 'minidsp' || availableDevices[selectedDeviceName].type === 'camilladsp')) {
        tabNames.push('Levels');
    }
    if (selectedDeviceName && availableDevices && availableDevices[selectedDeviceName].type === 'minidsp') {
        tabNames.push('Control');
    }
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
    const deviceMenuItems = availableDevices && Object.keys(availableDevices).length > 1
        ? Object.keys(availableDevices).map(d =>
            <MenuItem value={d}
                      key={d}
                      onClick={e => setSelectedDeviceName(availableDevices[d].name)}>
                {
                    selectedDeviceName && d === selectedDeviceName
                        ? <ListItemIcon><Check/></ListItemIcon>
                        : null
                }
                <ListItemText inset={!selectedDeviceName || d !== selectedDeviceName}>{d}</ListItemText>
            </MenuItem>
        ) : null;

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
            {/* Below `sm` the toolbar hides the What's New/Pair Mobile App icons entirely (see
                their xs display overrides below) to leave the search box as much room as
                possible - these two entries are how that functionality stays reachable there. */}
            <MenuItem onClick={openWhatsNewFromMenu}>
                <ListItemIcon><NewReleasesIcon/></ListItemIcon>
                <ListItemText>What's New</ListItemText>
            </MenuItem>
            <MenuItem onClick={openPairDialogFromMenu}>
                <ListItemIcon><PhoneIphoneIcon/></ListItemIcon>
                <ListItemText>Pair Mobile App</ListItemText>
            </MenuItem>
            <Divider/>
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
              slotProps={{
                  paper: {
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
                  }
              }}
              transformOrigin={{horizontal: 'right', vertical: 'top'}}
              anchorOrigin={{horizontal: 'right', vertical: 'bottom'}}>
            {navMenuItems}
            {deviceMenuItems ? <Divider/> : null}
            {deviceMenuItems}
        </Menu>
    );

    const shouldShowMenu = (availableDevices && Object.keys(availableDevices).length > 1) || tabNames.length > 1;

    return (
        <Box sx={{flexGrow: 1}}>
            <AppBar position="static" sx={{marginLeft: '0px', marginTop: '0px'}}>
                <Toolbar disableGutters={true}>
                    {/* Hidden below `sm` - see the mobile menu's What's New/Pair Mobile App entries
                        above, which take over on a phone-width screen so the search box (in
                        children, just below) gets that space instead. */}
                    <Avatar alt="beqcatalogue"
                            variant="rounded"
                            src={beqcIcon}
                            sx={{width: 32, height: 32, marginLeft: '12px', display: {xs: 'none', sm: 'flex'}}}/>
                    <IconButton size="small" onClick={onWhatsNewOpen} aria-label="What's New"
                                sx={{ml: 1, display: {xs: 'none', sm: 'inline-flex'}}}>
                        <Badge badgeContent={whatsNewCount || 0} color="error" max={99}>
                            <NewReleasesIcon/>
                        </Badge>
                    </IconButton>
                    <IconButton size="small" onClick={() => setPairDialogOpen(true)} aria-label="Pair Mobile App"
                                sx={{ml: 1, display: {xs: 'none', sm: 'inline-flex'}}}>
                        <PhoneIphoneIcon/>
                    </IconButton>
                    {/* These stop growing below `sm` so the search bar (in children - see its own
                        flexGrow: 1 xs override in Search.jsx) gets first claim on the freed space
                        instead of it going to empty spacers either side of it. The leading one
                        keeps a fixed width at xs, though - below `sm` it's the search bar's only
                        remaining inset from the toolbar's edge, now that the Avatar (whose own
                        marginLeft used to be that inset) is hidden there too. Toolbar's own
                        disableGutters means there's nothing else providing it. */}
                    <Box sx={{flexGrow: {xs: 0, sm: 0.5}, width: {xs: '12px', sm: 0}}}/>
                    {children}
                    <Box sx={{flexGrow: {xs: 0, sm: 0.5}, flexShrink: 2}}/>
                    <Box sx={{display: {xs: 'none', md: 'flex'}, marginRight: '8px'}}>
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
                    {/* This box is visible from xs through sm (hidden at md+, same as the desktop
                        trigger's own boundary above) - but unlike that one, it's always shown
                        rather than gated on shouldShowMenu: below `sm` it's the *only* way to
                        reach What's New/Pair Mobile App, so it can't disappear just because
                        there's no device/tab choice to make too. The dot signals an unread count
                        the same way the (now hidden-at-xs) numbered badge on the What's New icon
                        does, so that signal isn't silently lost on a phone; it's harmlessly
                        redundant with that badge across the sm range where both are visible. */}
                    <Box sx={{display: {xs: 'flex', md: 'none'}, marginRight: '8px'}}>
                        <IconButton
                            size="large"
                            aria-label="show more"
                            aria-controls={mobileMenuId}
                            aria-haspopup="true"
                            onClick={handleMobileMenuOpen}>
                            <Badge variant="dot" color="error" invisible={!(whatsNewCount > 0)}>
                                <MenuIcon/>
                            </Badge>
                        </IconButton>
                    </Box>
                </Toolbar>
            </AppBar>
            {renderMobileMenu}
            {renderMainMenu}
            <PairMobileAppDialog open={pairDialogOpen} onClose={() => setPairDialogOpen(false)}/>
        </Box>
    );
};

export default Header;