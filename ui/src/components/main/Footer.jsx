import React, {useEffect, useState} from "react";
import { styled } from '@mui/material/styles';
import ezbeq from "../../services/ezbeq";
import {pushData} from "../../services/util";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
const PREFIX = 'Footer';

const classes = {
    noLeft: `${PREFIX}-noLeft`
};

const StyledGrid = styled(Grid)((
    {
        theme
    }
) => ({
    [`&.${classes.noLeft}`]: {
        marginLeft: '0px'
    }
}));

const Footer = ({meta}) => {

    const [version, setVersion] = useState({});

    const padZero = n => n.toString().padStart(2, '0');
    const formatSeconds = s => {
        if (s) {
            const d = new Date(0);
            d.setUTCSeconds(s);
            return `${d.getFullYear()}${padZero(d.getMonth() + 1)}${padZero(d.getDate())}_${padZero(d.getHours())}${padZero(d.getMinutes())}${padZero(d.getSeconds())}`
        }
        return '?';
    }

    useEffect(() => {
        pushData(setVersion, ezbeq.getVersion);
    }, []);

    if (meta || version) {
        const sha1 = meta && meta.version ? meta.version.substring(0, 7) : '';
        return (
            <StyledGrid container justifyContent="space-around" gap={2} className={classes.noLeft} sx={{mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider'}}>
                <Grid>
                    <Typography variant={'caption'} color={'textSecondary'}>
                        {meta ? `cat: ${formatSeconds(meta.loaded)} / ${sha1}` : ''}
                    </Typography>
                </Grid>
                <Grid>
                    <Typography variant={'caption'} color={'textSecondary'}>
                        {(() => {
                            const gitRef = version.branch ? `${version.branch}@${version.sha || ''}` : version.sha || '';
                            const v = version.version;
                            const vStr = (v && v !== 'UNKNOWN') ? `v${v}` : (gitRef ? '' : (v || ''));
                            const gitStr = gitRef ? ` git: ${gitRef}` : '';
                            return vStr || gitStr ? `app: ${vStr}${gitStr}`.trim() : '';
                        })()}
                    </Typography>
                </Grid>
            </StyledGrid>
        );
    } else {
        return null;
    }
}

export default Footer;