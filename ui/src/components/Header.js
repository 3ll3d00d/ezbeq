import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import {Avatar, FormControl, MenuItem, Select} from "@material-ui/core";
import beqcIcon from "../beqc.png";
import Typography from "@material-ui/core/Typography";
import React from "react";
import {makeStyles} from "@material-ui/core/styles";

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
    white: {
        color: theme.palette.common.white,
    },
    smallAvatar: {
        width: theme.spacing(3),
        height: theme.spacing(3),
    }
}));

const Header = ({availableDeviceNames, setSelectedDeviceName, selectedDeviceName, children}) => {
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
                                    autoWidth={true}
                                    classes={{
                                        select: classes.white,
                                        icon: classes.white,
                                    }}>
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
                {children}
            </Toolbar>
        </AppBar>
    );
};

export default Header;