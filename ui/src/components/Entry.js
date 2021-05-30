import {
    Button,
    Card,
    CardContent,
    CardMedia,
    Checkbox,
    CircularProgress,
    FormControlLabel,
    FormGroup,
    makeStyles,
    Radio,
    RadioGroup
} from "@material-ui/core";
import Typography from "@material-ui/core/Typography";
import PublishIcon from "@material-ui/icons/Publish";
import React, {useEffect, useState} from "react";
import ezbeq from "../services/ezbeq";

const useStyles = makeStyles({
    root: {}
});

const formatExtraMeta = entry => {
    const extras = []
    if (entry.rating) {
        extras.push(entry.rating);
    }
    if (entry.runtime) {
        extras.push(`${Math.floor(entry.runtime / 60)}h ${entry.runtime % 60}m`);
    }
    if (entry.language && entry.language !== 'English') {
        extras.push(entry.language);
    }
    if (entry.genres) {
        extras.push(entry.genres.join(', '));
    }
    extras.push(entry.author);
    if (extras || entry.overview) {
        return <>
            {
                extras
                    ?
                    <Typography variant="body1" component="p">
                        {extras.join(' \u2022 ')}
                    </Typography>
                    : null
            }
            {
                entry.overview
                    ?
                    <Typography variant="body2" component="p">
                        {entry.overview}
                    </Typography>
                    : null
            }
        </>;
    } else {
        return null;
    }
}

const formatAudioTypes = entry => {
    if (entry && entry.audioTypes) {
        return entry.audioTypes.map(a => <span key={a}><br/>{a}</span>);
    }
    return null;
};

const formatMV = entry => {
    if (entry && entry.mvAdjust) {
        return (
            <span><br/>MV Adjustment: {entry.mvAdjust > 0 ? '+' : ''}{entry.mvAdjust} dB</span>
        )
    }
    return null;
};

const formatNote = entry => {
    if (entry && entry.note) {
        return (
            <span><br/>{entry.note}</span>
        )
    }
    return null;
};

const formatWarning = entry => {
    if (entry && entry.warning) {
        return (
            <span><br/><b>Warning:</b> {entry.warning}</span>
        )
    }
    return null;
};

const formatTV = entry => {
    if (entry && entry.season) {
        if (entry.episodes) {
            const is_dig = /^\d+$/.test(entry.episodes);
            if (is_dig) {
                return `S${entry.season} E${entry.episodes}`;
            } else {
                return `S${entry.season} ${entry.episodes}`;
            }
        } else {
            return `S${entry.season}`;
        }
    }
    return null;
};

const Uploader = ({
                      setSelectedSlot,
                      slotIds,
                      selectedSlot,
                      sendGain,
                      selectedEntry,
                      setSendGain,
                      device,
                      pending,
                      upload
                  }) => {
    const slotControls = slotIds.map(s => <FormControlLabel value={s}
                                                            control={<Radio checked={selectedSlot === s}
                                                                            color={'primary'}/>}
                                                            label={s}
                                                            key={s}/>);
    const slotGroup = slotIds.length > 1
        ?
        <RadioGroup row aria-label="slot" name="slot"
                    onChange={e => setSelectedSlot(e.target.value)}>
            {slotControls}
        </RadioGroup>
        : null;
    const gainControl = device && device.hasOwnProperty('masterVolume')
        ? <FormControlLabel control={<Checkbox checked={sendGain}
                                               name="sendMV"
                                               color={'primary'}
                                               disabled={!selectedEntry.mvAdjust}
                                               onChange={e => setSendGain(e.target.checked)}/>}
                            label="Set Input Gain"/>
        : null;
    return (
        <FormGroup row>
            {slotGroup}
            {gainControl}
            <Button variant="contained"
                    startIcon={pending ? <CircularProgress size={24}/> : <PublishIcon fontSize="small"/>}
                    onClick={upload}>
                Upload
            </Button>
        </FormGroup>
    );
};

const Entry = ({selectedEntry, useWide, setDevice, selectedSlotId, device, setError}) => {
    const classes = useStyles();
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [sendGain, setSendGain] = useState(false);
    const [pending, setPending] = useState(false);
    const slotIds = device && device.hasOwnProperty('slots') ? device.slots.map(s => s.id) : [];
    const canAcceptGain = device.hasOwnProperty('masterVolume');

    useEffect(() => {
        setSendGain(false);
    }, [selectedEntry]);

    useEffect(() => {
        setSelectedSlot(selectedSlotId);
    }, [selectedSlotId])

    const upload = async () => {
        const gains = {
            inputOne_mv: sendGain ? selectedEntry.mvAdjust : 0.0,
            inputOne_mute: false,
            inputTwo_mv: sendGain ? selectedEntry.mvAdjust : 0.0,
            inputTwo_mute: false
        }
        setPending(true);
        try {
            const call = canAcceptGain ? () => ezbeq.loadWithMV(selectedEntry.id, selectedSlot, gains) : () => ezbeq.sendFilter(selectedEntry.id, selectedSlot);
            const device = await call();
            setPending(false);
            setDevice(device);
        } catch (e) {
            setError(e);
            setPending(false);
        }
    };
    if (selectedEntry) {
        const images = selectedEntry.images
            ?
            selectedEntry.images.map((i, idx) =>
                <CardMedia
                    key={`img${idx}`}
                    component="img"
                    className={classes.media}
                    image={i}
                    title={`img${idx}`}
                    alt={`${selectedEntry.title} - ${idx}`}/>
            )
            : null;
        const content =
            <CardContent>
                <Typography gutterBottom variant="h5" component="h3">
                    {selectedEntry.title}
                    {selectedEntry.year ? ` (${selectedEntry.year})` : ''}
                </Typography>
                {
                    selectedEntry.edition
                        ?
                        <Typography variant="h6" component="p">
                            {selectedEntry.edition}
                        </Typography>
                        :
                        null
                }
                {
                    selectedEntry.altTitle && selectedEntry.altTitle !== selectedEntry.title
                        ?
                        <Typography variant="h6" component="p">
                            {selectedEntry.altTitle}
                        </Typography>
                        :
                        null
                }
                {
                    formatExtraMeta(selectedEntry)
                }
                <br/>
                <Typography variant="body2" color="textSecondary" component="p">
                    {formatTV(selectedEntry)}
                    {formatAudioTypes(selectedEntry)}
                    {formatMV(selectedEntry)}
                    {formatNote(selectedEntry)}
                    {formatWarning(selectedEntry)}
                </Typography>
            </CardContent>;
        const uploadAction =
            <CardContent>
                <Uploader setSelectedSlot={setSelectedSlot}
                          selectedSlot={selectedSlot}
                          sendGain={sendGain}
                          slotIds={slotIds}
                          selectedEntry={selectedEntry}
                          setSendGain={setSendGain}
                          pending={pending}
                          device={device}
                          upload={upload}/>
            </CardContent>;
        const links =
            <FormGroup row>
                {
                    selectedEntry.theMovieDB
                        ? <Button size="small"
                                  color="primary"
                                  href={`https://themoviedb.org/movie/${selectedEntry.theMovieDB}`}
                                  target='_avs'>TMDb</Button>
                        : null
                }
                {
                    selectedEntry.avsUrl
                        ? <Button size="small" color="primary" href={selectedEntry.avsUrl}
                                  target='_avs'>Discuss</Button>
                        : null
                }
                {
                    selectedEntry.beqcUrl
                        ? <Button size="small" color="primary" href={selectedEntry.beqcUrl}
                                  target='_beq'>Catalogue</Button>
                        : null
                }
            </FormGroup>;
        if (useWide) {
            return (
                <Card className={classes.root}>
                    {content}
                    {uploadAction}
                    {links}
                    {images}
                </Card>
            );
        } else {
            return (
                <Card className={classes.root}>
                    {uploadAction}
                    {content}
                    {links}
                    {images}
                </Card>
            );
        }
    } else {
        return null;
    }
};

export default Entry;
