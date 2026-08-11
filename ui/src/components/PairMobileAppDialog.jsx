import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import {QRCodeSVG} from "qrcode.react";

// Computed at render time (not import time) so it reflects whatever origin - LAN IP, hostname,
// reverse-proxied https - the browser is currently on, same as the app's own WS URL derivation
// in App.jsx.
export const serverOrigin = () => `${window.location.protocol}//${window.location.host}`;

const PairMobileAppDialog = ({open, onClose}) => {
    const origin = serverOrigin();
    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>Pair Mobile App</DialogTitle>
            <DialogContent>
                <Typography variant="body2" sx={{mb: 2}}>
                    Scan this code with the ezbeq mobile app to connect it to this server.
                </Typography>
                <Box sx={{display: 'flex', justifyContent: 'center', p: 1}}>
                    <QRCodeSVG value={origin} size={220}/>
                </Box>
                <Typography variant="body2" align="center" sx={{mt: 2, wordBreak: 'break-all'}}>
                    {origin}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default PairMobileAppDialog;
