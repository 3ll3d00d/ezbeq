import React, {useState} from 'react';
import {
    Box,
    Collapse,
    Divider,
    IconButton,
    Slider,
    TextField,
    Tooltip,
    Typography
} from "@mui/material";
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const dp = (step) => step < 0.1 ? 2 : step < 1 ? 1 : 0;

const GainRow = ({label, minGain, maxGain, step, value, muted, savedValue, savedMuted, onValueChange, onValueCommit, onMuteToggle}) => {
    const isDirty = parseFloat(value) !== parseFloat(savedValue) || muted !== savedMuted;
    const numValue = parseFloat(value);
    const isValid = !isNaN(numValue);
    const decimals = dp(step);

    return (
        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5}}>
            <Typography variant="body2" noWrap
                        sx={{minWidth: 0, width: 44, color: 'text.secondary', fontSize: '0.75rem'}}>
                {label}
            </Typography>
            <Slider
                size="small"
                min={minGain}
                max={maxGain}
                step={step}
                value={isValid ? numValue : minGain}
                onChange={(_, v) => onValueChange(v.toFixed(decimals))}
                onChangeCommitted={(_, v) => onValueCommit(v.toFixed(decimals))}
                sx={{flex: 1, minWidth: 0, color: isDirty ? 'secondary.main' : 'primary.main'}}
                disabled={muted}
            />
            <TextField
                size="small"
                value={value}
                onChange={e => onValueChange(e.target.value)}
                onBlur={e => {
                    const f = parseFloat(e.target.value);
                    if (!isNaN(f)) onValueCommit(Math.min(maxGain, Math.max(minGain, f)).toFixed(decimals));
                }}
                inputProps={{inputMode: 'decimal'}}
                sx={{
                    width: 68,
                    flexShrink: 0,
                    '& .MuiOutlinedInput-root': {color: isDirty ? 'secondary.main' : 'inherit'},
                    '& .MuiOutlinedInput-input': {textAlign: 'right', padding: '3px 4px', fontSize: '0.75rem'}
                }}
                variant="outlined"
            />
            <Tooltip title={muted ? 'Unmute' : 'Mute'}>
                <IconButton
                    size="small"
                    onClick={() => onMuteToggle(!muted)}
                    sx={{color: muted ? 'error.main' : 'action.active', p: 0.5, flexShrink: 0}}
                >
                    {muted ? <VolumeOffIcon fontSize="small"/> : <VolumeUpIcon fontSize="small"/>}
                </IconButton>
            </Tooltip>
        </Box>
    );
};

const Gain = ({selectedSlotId, deviceGains, gains, updateGain, commitGain}) => {
    const [channelsOpen, setChannelsOpen] = useState(false);
    const hasInputChannels = gains.gains && gains.gains.length > 0;
    const hasOutputChannels = gains.output_gains && gains.output_gains.length > 0;
    const hasChannels = selectedSlotId !== null && (hasInputChannels || hasOutputChannels);
    const channelCount = (gains.gains?.length ?? 0) + (gains.output_gains?.length ?? 0);

    if (!gains.hasOwnProperty('master_mv')) return <div/>;

    return (
        <Box sx={{pt: 1, px: 0.5, width: '100%'}}>
            <GainRow
                label="Master"
                minGain={-127} maxGain={0} step={0.5}
                value={gains.master_mv}
                muted={gains.master_mute}
                savedValue={deviceGains.master_mv}
                savedMuted={deviceGains.master_mute}
                onValueChange={v => updateGain('master', 'mv', v)}
                onValueCommit={v => commitGain('master', 'mv', v)}
                onMuteToggle={v => commitGain('master', 'mute', v)}
            />

            {hasChannels && (
                <>
                    <Box sx={{display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', py: 0.25}}
                         onClick={() => setChannelsOpen(o => !o)}>
                        <Typography variant="caption" sx={{color: 'text.secondary', flex: 1}}>
                            Channels ({channelCount})
                        </Typography>
                        <IconButton size="small" sx={{p: 0.25}}>
                            <ExpandMoreIcon fontSize="small"
                                            sx={{transform: channelsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s'}}/>
                        </IconButton>
                    </Box>
                    <Collapse in={channelsOpen} timeout="auto" unmountOnExit>
                        <Divider sx={{mb: 0.5}}/>
                        {hasInputChannels && gains.gains.map((g, i) => (
                            <GainRow
                                key={`input-${g.id}`}
                                label={`In ${g.id}`}
                                minGain={-72} maxGain={12} step={0.25}
                                value={g.value}
                                muted={gains.mutes[i]?.value ?? false}
                                savedValue={deviceGains.gains[i]?.value ?? 0}
                                savedMuted={deviceGains.mutes[i]?.value ?? false}
                                onValueChange={v => updateGain(g.id, 'mv', v)}
                                onValueCommit={v => commitGain(g.id, 'mv', v)}
                                onMuteToggle={v => commitGain(g.id, 'mute', v)}
                            />
                        ))}
                        {hasOutputChannels && (
                            <>
                                {hasInputChannels && <Divider sx={{my: 0.5}}/>}
                                {gains.output_gains.map((g, i) => (
                                    <GainRow
                                        key={`output-${g.id}`}
                                        label={`Out ${g.id}`}
                                        minGain={-72} maxGain={12} step={0.25}
                                        value={g.value}
                                        muted={gains.output_mutes[i]?.value ?? false}
                                        savedValue={deviceGains.output_gains?.[i]?.value ?? 0}
                                        savedMuted={deviceGains.output_mutes?.[i]?.value ?? false}
                                        onValueChange={v => updateGain(`out_${g.id}`, 'mv', v)}
                                        onValueCommit={v => commitGain(`out_${g.id}`, 'mv', v)}
                                        onMuteToggle={v => commitGain(`out_${g.id}`, 'mute', v)}
                                    />
                                ))}
                            </>
                        )}
                    </Collapse>
                </>
            )}
        </Box>
    );
};

export default Gain;
