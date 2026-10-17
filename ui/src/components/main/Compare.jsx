import React, {useCallback, useEffect, useMemo, useState} from "react";
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    ToggleButton,
    ToggleButtonGroup,
    useMediaQuery,
    useTheme
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import ezbeq from "../../services/ezbeq";
import {cascadeResponseDb, logSpace} from "../../services/biquad";

const COLOURS = ['#2f6fed', '#e0523c', '#3fae5c', '#c9931f', '#8956d6', '#1fa3a3', '#d64f8a', '#6b7280'];
// once the colours run out, repeat them with a different dash so every series stays distinguishable
const DASHES = [null, [6, 4], [2, 3], [8, 3, 2, 3]];
const FREQS = logSpace(1, 200, 200);
const RESPONSE = 'response';
const DIFFERENCE = 'difference';

export const variantLabel = entry => {
    const parts = [];
    if (entry.season) parts.push(`S${entry.season}${entry.episode ? `E${entry.episode}` : ''}`);
    if (entry.edition) parts.push(entry.edition);
    return parts.join(' • ');
};

// largest absolute deviation between two responses, as {db, freq}
export const maxDifference = (base, other, freqs = FREQS) => {
    let worst = {db: 0, freq: null};
    other.forEach((v, i) => {
        const delta = v - base[i];
        if (Math.abs(delta) > Math.abs(worst.db)) worst = {db: delta, freq: freqs[i]};
    });
    return worst;
};

const formatDb = v => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

const useWidth = () => {
    const [width, setWidth] = useState(0);
    const ref = useCallback(el => {
        if (!el) return;
        setWidth(el.clientWidth || 600);
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([e]) => {
            if (e.contentRect.width) setWidth(Math.floor(e.contentRect.width));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return [ref, width];
};

const CompareDialog = ({selectedEntry, matches, onSelect, onClose, setError}) => {
    const theme = useTheme();
    // phones get a full screen dialog with a list instead of a table, and a chart without its legend
    const compact = useMediaQuery(theme.breakpoints.down('md'));
    const [filtersById, setFiltersById] = useState(null);
    const [failed, setFailed] = useState(false);
    const [mode, setMode] = useState(RESPONSE);
    const [chartRef, chartWidth] = useWidth();
    const all = useMemo(() => [selectedEntry, ...matches], [selectedEntry, matches]);
    // a catalogue refresh produces new entry objects for the same ids, which shouldn't trigger a reload
    const idsKey = all.map(e => e.id).join('\n');

    useEffect(() => {
        let cancelled = false;
        ezbeq.getFilters(idsKey.split('\n'))
            .then(results => {
                if (!cancelled) setFiltersById(Object.fromEntries(results.map(r => [r.id, r.filters])));
            })
            .catch(e => {
                if (cancelled) return;
                setFailed(true);
                if (setError) setError(e);
            });
        return () => {
            cancelled = true;
        };
    }, [idsKey, setError]);

    const responses = useMemo(
        () => filtersById
            ? all.map(e => filtersById[e.id] ? cascadeResponseDb(filtersById[e.id], FREQS) : null)
            : null,
        [all, filtersById]
    );
    const base = responses ? responses[0] : null;
    const showDifference = mode === DIFFERENCE && base;

    const styleOf = idx => idx === 0
        ? {colour: theme.palette.text.primary, dash: null, width: 3}
        : {
            colour: COLOURS[(idx - 1) % COLOURS.length],
            dash: DASHES[Math.floor((idx - 1) / COLOURS.length) % DASHES.length],
            width: 1.5
        };
    const swatch = idx => {
        const {colour, dash, width} = styleOf(idx);
        return (
            <svg width="20" height="6" aria-hidden="true" style={{flexShrink: 0}}>
                <line x1="0" y1="3" x2="20" y2="3" stroke={colour} strokeWidth={width + 1}
                      strokeDasharray={dash ? dash.join(' ') : undefined}/>
            </svg>
        );
    };
    const labelOf = (e, idx) => `${idx === 0 ? 'Selected: ' : ''}${e.author} — ${(e.audioTypes || []).join(', ')}`;

    const chart = useMemo(() => {
        if (!responses || !chartWidth) return null;
        const plotted = all.map((e, idx) => ({e, idx, response: responses[idx]})).filter(p => p.response);
        const data = [
            FREQS,
            ...plotted.map(p => showDifference ? p.response.map((v, i) => v - base[i]) : p.response)
        ];
        const axis = {
            stroke: theme.palette.text.primary,
            ticks: {stroke: theme.palette.divider},
            grid: {stroke: theme.palette.divider}
        };
        const options = {
            width: chartWidth,
            height: Math.min(400, Math.max(200, Math.round(chartWidth * (compact ? 0.65 : 0.5)))),
            legend: {show: !compact},
            scales: {x: {time: false, distr: 3, log: 10, range: [FREQS[0], FREQS[FREQS.length - 1]]}},
            series: [
                {label: 'Hz', value: (u, v) => v == null ? '-' : `${v.toFixed(1)} Hz`},
                ...plotted.map(p => ({
                    label: labelOf(p.e, p.idx),
                    stroke: styleOf(p.idx).colour,
                    width: styleOf(p.idx).width,
                    ...(styleOf(p.idx).dash ? {dash: styleOf(p.idx).dash} : {}),
                    value: (u, v) => v == null ? '-' : formatDb(v)
                }))
            ],
            axes: compact
                ? [{...axis, size: 30}, {...axis, size: 36, label: showDifference ? '\u0394 dB' : 'dB', labelSize: 20}]
                : [
                    {...axis, label: 'Frequency (Hz)'},
                    {...axis, label: showDifference ? 'Difference vs selected (dB)' : 'Gain (dB)'}
                ]
        };
        return {data, options};
    }, [all, responses, base, showDifference, chartWidth, theme, compact]);

    const rows = all.map((e, idx) => {
        const filters = filtersById ? filtersById[e.id] : null;
        const response = responses ? responses[idx] : null;
        const diff = idx > 0 && base && response ? maxDifference(base, response) : null;
        return {
            e, idx,
            audio: (e.audioTypes || []).join(', '),
            mv: e.mvAdjust ? formatDb(Number(e.mvAdjust)) : '',
            filterCount: filters ? filters.reduce((t, f) => t + (f.count || 1), 0) : null,
            // no freq means the responses are identical
            diff: diff ? (diff.freq ? `${formatDb(diff.db)} @ ${diff.freq.toFixed(0)} Hz` : formatDb(0)) : ''
        };
    });

    const select = id => {
        onSelect(id);
        onClose();
    };

    const selectAction = r => r.idx === 0
        ? <Chip size="small" label="Selected"/>
        : <Button size="small" variant="outlined" onClick={() => select(r.e.id)}>Select</Button>;

    return (
        <Dialog open onClose={onClose} fullScreen={compact} fullWidth maxWidth="lg"
                aria-labelledby="compare-dialog-title">
            <DialogTitle id="compare-dialog-title" sx={compact ? {pr: 6} : null}>
                Compare: {selectedEntry.title}{selectedEntry.year ? ` (${selectedEntry.year})` : ''}
            </DialogTitle>
            {
                // full screen, so keep close at the top where snackbars can't cover it
                compact
                    ? <IconButton aria-label="Close" onClick={onClose} sx={{position: 'absolute', right: 8, top: 8}}>
                        <CloseIcon/>
                    </IconButton>
                    : null
            }
            <DialogContent dividers sx={compact ? {px: 1} : null}>
                <ToggleButtonGroup size="small" exclusive value={mode} sx={{mb: 1}}
                                   onChange={(e, v) => v && setMode(v)}>
                    <ToggleButton value={RESPONSE}>Response</ToggleButton>
                    <ToggleButton value={DIFFERENCE} disabled={!base}>Difference</ToggleButton>
                </ToggleButtonGroup>
                <Box ref={chartRef} sx={{width: '100%'}}>
                    {
                        failed
                            ? <Alert severity="error">Unable to load filters</Alert>
                            : chart
                                ? <UplotReact options={chart.options} data={chart.data}/>
                                : <Box sx={{display: 'flex', justifyContent: 'center', p: 4}}>
                                    <CircularProgress size={28}/>
                                </Box>
                    }
                </Box>
                {
                    compact
                        ? <List dense aria-label="matching filters">
                            {
                                rows.map(r => (
                                    <ListItem key={r.e.id} disableGutters divider
                                              secondaryAction={selectAction(r)}
                                              sx={r.idx === 0 ? {bgcolor: 'action.selected'} : null}>
                                        <Box sx={{mx: 1, display: 'flex'}}>{swatch(r.idx)}</Box>
                                        <ListItemText
                                            primary={`${r.e.author} \u2014 ${r.audio}`}
                                            secondary={[
                                                variantLabel(r.e),
                                                r.mv && `MV ${r.mv}`,
                                                r.filterCount != null && `${r.filterCount} filters`,
                                                r.diff && `max diff ${r.diff}`
                                            ].filter(Boolean).join(' \u2022 ')}
                                            sx={{pr: 10}}/>
                                    </ListItem>
                                ))
                            }
                        </List>
                        : <TableContainer>
                            <Table size="small" aria-label="matching filters">
                                <TableHead>
                                    <TableRow>
                                        <TableCell/>
                                        <TableCell>Author</TableCell>
                                        <TableCell>Audio</TableCell>
                                        <TableCell>Variant</TableCell>
                                        <TableCell align="right">MV</TableCell>
                                        <TableCell align="right">Filters</TableCell>
                                        <TableCell align="right">Max Diff</TableCell>
                                        <TableCell/>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {
                                        rows.map(r => (
                                            <TableRow key={r.e.id} selected={r.idx === 0}>
                                                <TableCell>
                                                    {swatch(r.idx)}
                                                </TableCell>
                                                <TableCell>{r.e.author}</TableCell>
                                                <TableCell>{r.audio}</TableCell>
                                                <TableCell>{variantLabel(r.e)}</TableCell>
                                                <TableCell align="right">{r.mv}</TableCell>
                                                <TableCell align="right">{r.filterCount}</TableCell>
                                                <TableCell align="right">{r.diff}</TableCell>
                                                <TableCell align="right">{selectAction(r)}</TableCell>
                                            </TableRow>
                                        ))
                                    }
                                </TableBody>
                            </Table>
                        </TableContainer>
                }
            </DialogContent>
            {
                compact
                    ? null
                    : <DialogActions>
                        <Button onClick={onClose}>Close</Button>
                    </DialogActions>
            }
        </Dialog>
    );
};

export default CompareDialog;
