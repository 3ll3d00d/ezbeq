import {
    Button,
    Card,
    CardActionArea,
    CardActions,
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

const Entry = ({selectedEntry, useWide, setDevice}) => {
    const classes = useStyles();
    const [selectedSlot, setSelectedSlot] = useState(1);
    const [sendGain, setSendGain] = useState(false);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (selectedEntry && selectedEntry.mvAdjust) {
            setSendGain(true);
        } else {
            setSendGain(false);
        }
    }, [selectedEntry]);

    const upload = async () => {
        const gains = {
            inputOne_mv: sendGain ? selectedEntry.mvAdjust : 0.0,
            inputOne_mute: false,
            inputTwo_mv: sendGain ? selectedEntry.mvAdjust : 0.0,
            inputTwo_mute: false
        }
        setPending(true);
        try {
            const device = await ezbeq.loadWithMV(selectedSlot, gains, selectedEntry.id);
            setPending(false);
            setDevice(device);
        } catch (e) {
            console.error(e);
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
                        <Typography variant="body1" component="p">
                            {selectedEntry.edition}
                        </Typography>
                        :
                        null
                }
                {
                    selectedEntry.altTitle
                        ?
                        <Typography variant="body1" component="p">
                            {selectedEntry.altTitle}
                        </Typography>
                        :
                        null
                }
                <Typography variant="body2" color="textSecondary" component="p">
                    {formatTV(selectedEntry)}
                    {formatAudioTypes(selectedEntry)}
                    {formatMV(selectedEntry)}
                </Typography>
                <FormGroup row>
                    <RadioGroup row aria-label="slot" name="slot"
                                onChange={e => setSelectedSlot(parseInt(e.target.value))}>
                        <FormControlLabel value="1" control={<Radio checked={selectedSlot === 1} color={'primary'}/>}
                                          label="One"/>
                        <FormControlLabel value="2" control={<Radio checked={selectedSlot === 2} color={'primary'}/>}
                                          label="Two"/>
                        <FormControlLabel value="3" control={<Radio checked={selectedSlot === 3} color={'primary'}/>}
                                          label="Three"/>
                        <FormControlLabel value="4" control={<Radio checked={selectedSlot === 4} color={'primary'}/>}
                                          label="Four"/>
                    </RadioGroup>
                    <FormControlLabel
                        control={<Checkbox checked={sendGain}
                                           name="sendMV"
                                           color={'primary'}
                                           disabled={!selectedEntry.mvAdjust}
                                           onChange={e => setSendGain(e.target.checked)}/>}
                        label="Set Input Gain"/>
                    <Button variant="contained"
                            startIcon={pending ? <CircularProgress size={24}/> : <PublishIcon fontSize="small"/>}
                            onClick={upload}>
                        Upload
                    </Button>
                </FormGroup>
            </CardContent>;
        const actionArea = useWide
            ?
            <CardActionArea>
                {content}
                {images}
            </CardActionArea>
            :
            <CardActionArea>
                {images}
                {content}
            </CardActionArea>;
        return (
            <Card className={classes.root}>
                {actionArea}
                <CardActions>
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
                </CardActions>
            </Card>
        );
    } else {
        return null;
    }
};

export default Entry;
