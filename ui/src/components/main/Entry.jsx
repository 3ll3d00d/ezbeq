import {
    Button,
    Card,
    CardContent,
    CardMedia,
    Checkbox,
    CircularProgress,
    FormControlLabel,
    FormGroup,
    Radio,
    RadioGroup
} from "@mui/material";
import Typography from "@mui/material/Typography";
import PublishIcon from "@mui/icons-material/Publish";
import React, {useEffect, useMemo, useState} from "react";
import ezbeq from "../../services/ezbeq";

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
                      setUploadSlotId,
                      slots,
                      uploadSlotId,
                      sendGain,
                      selectedEntry,
                      setSendGain,
                      pending,
                      upload
                  }) => {
    const slotControls = slots.map(s => <FormControlLabel value={s.id}
                                                          control={<Radio checked={uploadSlotId === s.id}
                                                                          color={'primary'}/>}
                                                          label={s.id}
                                                          key={s.id}/>);
    const slotGroup = slots.length > 1
        ?
        <RadioGroup row aria-label="slot" name="slot"
                    onChange={e => setUploadSlotId(e.target.value)}>
            {slotControls}
        </RadioGroup>
        : null;
    const slot = slots.find(s => s.id === uploadSlotId);
    const gainControl = slot && slot.inputs > 0
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

const Entry = ({selectedDevice, selectedEntry, useWide, setDevice, selectedSlotId, device, setError}) => {
    const slots = useMemo(() => device && device.hasOwnProperty('slots') ? device.slots : [], [device]);
    const [uploadSlotId, setUploadSlotId] = useState(null);
    const [sendGain, setSendGain] = useState(false);
    const [pending, setPending] = useState(false);
    const [acceptGain, setAcceptGain] = useState(false);

    useEffect(() => {
        setSendGain(false);
    }, [selectedEntry]);

    useEffect(() => {
        const slot = slots.find(s => s.id === uploadSlotId);
        const accepted = slot && device.hasOwnProperty('masterVolume') && slot.inputs > 0;
        setAcceptGain(accepted);
    }, [device, slots, uploadSlotId]);

    useEffect(() => {
        if (!uploadSlotId) {
            setUploadSlotId(selectedSlotId);
        }
    }, [uploadSlotId, selectedSlotId]);

    const upload = async () => {
        const slot = slots.find(s => s.id === uploadSlotId);
        const gains = {
            'gains': [...Array(slot.inputs)].map((_, i) => sendGain ? parseFloat(selectedEntry.mvAdjust) : 0.0),
            'mutes': sendGain ? [...Array(slot.inputs)].map((_, i) => false) : []
        }
        setPending(true);
        try {
            const call = acceptGain
                ? () => ezbeq.loadWithMV(selectedDevice.name, selectedEntry.id, uploadSlotId, gains)
                : () => ezbeq.sendFilter(selectedDevice.name, selectedEntry.id, uploadSlotId);
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
                    image={i}
                    title={`img${idx}`}
                    alt={`${selectedEntry.title} - ${idx}`}
                />
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
                <Uploader setUploadSlotId={setUploadSlotId}
                          uploadSlotId={uploadSlotId}
                          sendGain={sendGain}
                          slots={slots}
                          selectedEntry={selectedEntry}
                          setSendGain={setSendGain}
                          pending={pending}
                          upload={upload}/>
            </CardContent>;
        const links =
            <FormGroup row>
                {
                    selectedEntry.theMovieDB
                        ? <Button size="small"
                                  color="primary"
                                  href={`https://themoviedb.org/${selectedEntry.contentType === 'film' ? 'movie' : 'tv'}/${selectedEntry.theMovieDB}`}
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
                <Card>
                    {content}
                    {uploadAction}
                    {links}
                    {images}
                </Card>
            );
        } else {
            return (
                <Card>
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
