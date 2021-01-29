import {Button, Card, CardActionArea, CardActions, CardContent, CardMedia, makeStyles} from "@material-ui/core";
import Typography from "@material-ui/core/Typography";

const useStyles = makeStyles({
    root: {
    }
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

const Entry = ({selectedEntry}) => {
    const classes = useStyles();
    if (selectedEntry) {
        console.log(selectedEntry);
    }
    if (selectedEntry) {
        return (
            <Card className={classes.root}>
                <CardActionArea>
                    {
                        selectedEntry.images
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
                        : null
                    }
                    <CardContent>
                        <Typography gutterBottom variant="h5" component="h3">
                            {selectedEntry.title} {selectedEntry.year ? `(${selectedEntry.year})` : ''}
                        </Typography>
                        <Typography variant="body2" color="textSecondary" component="p">
                            {formatTV(selectedEntry)}
                            {formatAudioTypes(selectedEntry)}
                            {formatMV(selectedEntry)}
                        </Typography>
                    </CardContent>
                </CardActionArea>
                <CardActions>
                    {
                        selectedEntry.avsUrl
                        ? <Button size="small" color="primary" href={selectedEntry.avsUrl} target='_avs'>Discuss</Button>
                        : null
                    }
                    {
                        selectedEntry.beqcUrl
                        ? <Button size="small" color="primary" href={selectedEntry.beqcUrl} target='_beq'>Catalogue</Button>
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
