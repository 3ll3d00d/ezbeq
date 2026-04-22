import React, {useState} from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';

const WhatsNew = ({onClose, entries, lastChecked, onSelect, initialMode}) => {
    const [mode, setMode] = useState(initialMode ?? 'new');

    const visible = mode === 'new'
        ? entries.filter(e => Math.max(e.created_at || 0, e.updated_at || 0) >= lastChecked)
        : entries;

    return (
        <Drawer anchor="left" open={true} onClose={onClose} transitionDuration={0}
                variant="persistent"
                slotProps={{paper: {sx: {top: {xs: '56px', sm: '64px'}, height: {xs: 'calc(100% - 56px)', sm: 'calc(100% - 64px)'}}}}}>

            <Box sx={{width: {xs: '100vw', sm: 400}, display: 'flex', flexDirection: 'column', height: '100%'}}>
                <Box sx={{display: 'flex', alignItems: 'center', p: 1.5, gap: 1}}>
                    <Typography variant="h6" sx={{flexGrow: 1}}>What's New</Typography>
                    <ToggleButtonGroup size="small" value={mode} exclusive onChange={(_, v) => v && setMode(v)}>
                        <ToggleButton value="new">New</ToggleButton>
                        <ToggleButton value="recent">Recent</ToggleButton>
                    </ToggleButtonGroup>
                    <IconButton size="small" onClick={onClose}><CloseIcon/></IconButton>
                </Box>
                <Divider/>
                {visible.length === 0
                    ? <Box sx={{p: 3}}><Typography color="text.secondary">
                        {mode === 'new' ? 'Nothing new since your last check.' : 'No recent titles in the last 2 weeks.'}
                    </Typography></Box>
                    : <List dense disablePadding sx={{overflowY: 'auto', flexGrow: 1}}>
                        {visible.map((entry, idx) => (
                            <React.Fragment key={entry.id ?? idx}>
                                <ListItem button onClick={() => onSelect(entry.id)} sx={{flexDirection: 'column', alignItems: 'flex-start', py: 1.5, px: 2, gap: 0.5, cursor: 'pointer'}}>
                                    <Typography variant="body1" sx={{fontWeight: 500, lineHeight: 1.3}}>
                                        {entry.formattedTitle}{entry.year ? ` (${entry.year})` : ''}
                                    </Typography>
                                    <Box sx={{display: 'flex', flexWrap: 'wrap', gap: 0.5}}>
                                        {entry.freshness === 'Fresh'
                                            ? <Chip label="New" size="small" color="success" variant="outlined"/>
                                            : <Chip label="Updated" size="small" color="info" variant="outlined"/>}
                                        {entry.author && <Chip label={entry.author} size="small" variant="outlined"/>}
                                        {entry.audioTypes && entry.audioTypes.map(t => (
                                            <Chip key={t} label={t} size="small" variant="outlined" sx={{opacity: 0.75}}/>
                                        ))}
                                    </Box>
                                </ListItem>
                                {idx < visible.length - 1 && <Divider component="li"/>}
                            </React.Fragment>
                        ))}
                    </List>
                }
            </Box>
        </Drawer>
    );
};

export default WhatsNew;
