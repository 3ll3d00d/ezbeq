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
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    ToggleButton,
    ToggleButtonGroup,
    useMediaQuery,
    useTheme
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import ezbeq from "../../services/ezbeq";
import {cascadeResponseDb, coefficientResponseDb, logSpace} from "../../services/biquad";

const COLOURS = ['#2f6fed', '#e0523c', '#3fae5c', '#c9931f', '#8956d6', '#1fa3a3', '#d64f8a', '#6b7280'];
// once the colours run out, repeat them with a different dash so every series stays distinguishable
const DASHES = [null, [6, 4], [2, 3], [8, 3, 2, 3]];
const FREQS = logSpace(1, 200, 200);
const RESPONSE = 'response';
const DIFFERENCE = 'difference';
const RELEASES = 'releases';
const OPTIMISATION = 'optimisation';

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

const swatchOf = ({colour, dash, width}) => (
    <svg width="20" height="6" aria-hidden="true" style={{flexShrink: 0}}>
        <line x1="0" y1="3" x2="20" y2="3" stroke={colour} strokeWidth={width + 1}
              strokeDasharray={dash ? dash.join(' ') : undefined}/>
    </svg>
);

const ModeToggle = ({mode, setMode, canDiff}) => (
    <ToggleButtonGroup size="small" exclusive value={mode} sx={{mb: 1}} onChange={(e, v) => v && setMode(v)}>
        <ToggleButton value={RESPONSE}>Response</ToggleButton>
        <ToggleButton value={DIFFERENCE} disabled={!canDiff}>Difference</ToggleButton>
    </ToggleButtonGroup>
);

// series is [{label, data, style}] or null while loading
const ResponsePlot = ({series, failed, yLabel, compactYLabel, compact}) => {
    const theme = useTheme();
    const [chartRef, chartWidth] = useWidth();
    const chart = useMemo(() => {
        if (!series || !chartWidth) return null;
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
                ...series.map(s => ({
                    label: s.label,
                    stroke: s.style.colour,
                    width: s.style.width,
                    ...(s.style.dash ? {dash: s.style.dash} : {}),
                    value: (u, v) => v == null ? '-' : formatDb(v)
                }))
            ],
            axes: compact
                ? [{...axis, size: 30}, {...axis, size: 36, label: compactYLabel, labelSize: 20}]
                : [{...axis, label: 'Frequency (Hz)'}, {...axis, label: yLabel}]
        };
        return {data: [FREQS, ...series.map(s => s.data)], options};
    }, [series, chartWidth, theme, compact, yLabel, compactYLabel]);
    return (
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
    );
};

// the selected entry against the other releases of the same title
const ReleaseComparison = ({selectedEntry, matches, mode, setMode, compact, onSelect, setError}) => {
    const theme = useTheme();
    const [filtersById, setFiltersById] = useState(null);
    const [failed, setFailed] = useState(false);
    const all = useMemo(() => [selectedEntry, ...matches], [selectedEntry, matches]);
    // a catalogue refresh produces new entry objects for the same ids, which shouldn't trigger a reload
    const idsKey = all.map(e => e.id).join('\n');

    useEffect(() => {
        let cancelled = false;
        setFailed(false);
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
    const labelOf = (e, idx) => `${idx === 0 ? 'Selected: ' : ''}${e.author} — ${(e.audioTypes || []).join(', ')}`;

    const series = useMemo(() => responses
        ? all.map((e, idx) => ({e, idx, response: responses[idx]}))
            .filter(p => p.response)
            .map(p => ({
                label: labelOf(p.e, p.idx),
                style: styleOf(p.idx),
                data: showDifference ? p.response.map((v, i) => v - base[i]) : p.response
            }))
        : null,
        [all, responses, base, showDifference, theme]);

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

    const selectAction = r => r.idx === 0
        ? <Chip size="small" label="Selected"/>
        : <Button size="small" variant="outlined" onClick={() => onSelect(r.e.id)}>Select</Button>;

    return (
        <>
            <ModeToggle mode={mode} setMode={setMode} canDiff={Boolean(base)}/>
            <ResponsePlot series={series} failed={failed} compact={compact}
                          yLabel={showDifference ? 'Difference vs selected (dB)' : 'Gain (dB)'}
                          compactYLabel={showDifference ? 'Δ dB' : 'dB'}/>
            {
                compact
                    ? <List dense aria-label="matching filters">
                        {
                            rows.map(r => (
                                <ListItem key={r.e.id} disableGutters divider
                                          secondaryAction={selectAction(r)}
                                          sx={r.idx === 0 ? {bgcolor: 'action.selected'} : null}>
                                    <Box sx={{mx: 1, display: 'flex'}}>{swatchOf(styleOf(r.idx))}</Box>
                                    <ListItemText
                                        primary={`${r.e.author} — ${r.audio}`}
                                        secondary={[
                                            variantLabel(r.e),
                                            r.mv && `MV ${r.mv}`,
                                            r.filterCount != null && `${r.filterCount} filters`,
                                            r.diff && `max diff ${r.diff}`
                                        ].filter(Boolean).join(' • ')}
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
                                                {swatchOf(styleOf(r.idx))}
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
        </>
    );
};

// the authored coefficients as published (ideal), the authored and the optimised coefficients each as realised by the
// device, null while loading
export const optimisationResponses = coefficients => {
    if (!coefficients) return null;
    // only float32 storage is modelled, anything else is treated as exact
    const quantise = coefficients.precision === 'float32' ? Math.fround : undefined;
    return {
        ideal: coefficientResponseDb(coefficients.authored, FREQS, coefficients.rate),
        unoptimised: coefficientResponseDb(coefficients.authored, FREQS, coefficients.rate, quantise),
        optimised: coefficientResponseDb(coefficients.optimised, FREQS, coefficients.rate, quantise)
    };
};

const OPTIMISATION_SERIES = [
    {key: 'ideal', label: 'Ideal', colourOf: theme => theme.palette.text.primary, width: 3},
    {key: 'unoptimised', label: 'Unoptimised (as loaded)', colourOf: () => COLOURS[1], width: 1.5},
    {key: 'optimised', label: 'Optimised (as loaded)', colourOf: () => COLOURS[2], width: 1.5, dash: DASHES[1]}
];

// the selected entry's authored coefficients against those optimised for the device
const OptimisationComparison = ({selectedEntry, deviceName, mode, setMode, compact, setError}) => {
    const theme = useTheme();
    const [coefficients, setCoefficients] = useState(null);
    const [failed, setFailed] = useState(false);
    const entryId = selectedEntry.id;

    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        setCoefficients(null);
        ezbeq.getEntryCoefficients(deviceName, entryId)
            .then(r => {
                if (!cancelled) setCoefficients(r);
            })
            .catch(e => {
                if (cancelled) return;
                setFailed(true);
                if (setError) setError(e);
            });
        return () => {
            cancelled = true;
        };
    }, [deviceName, entryId, setError]);

    const responses = useMemo(() => optimisationResponses(coefficients), [coefficients]);
    const showDifference = mode === DIFFERENCE;
    const styleOf = s => ({colour: s.colourOf(theme), dash: s.dash || null, width: s.width});
    const series = useMemo(() => responses
        ? OPTIMISATION_SERIES.map(s => ({
            label: s.label,
            style: styleOf(s),
            data: showDifference ? responses[s.key].map((v, i) => v - responses.ideal[i]) : responses[s.key]
        }))
        : null,
        [responses, showDifference, theme]);

    const rows = OPTIMISATION_SERIES.map(s => {
        const err = responses && s.key !== 'ideal' ? maxDifference(responses.ideal, responses[s.key]) : null;
        return {
            s,
            error: err ? (err.freq ? `${formatDb(err.db)} @ ${err.freq.toFixed(0)} Hz` : formatDb(0)) : ''
        };
    });

    return (
        <>
            <ModeToggle mode={mode} setMode={setMode} canDiff={Boolean(responses)}/>
            {
                coefficients
                    ? <Alert severity="info" sx={{mb: 1}}>
                        As loaded by {deviceName} ({coefficients.label}), the unoptimised filters are the authored
                        coefficients and the optimised filters are those published for this device.
                    </Alert>
                    : null
            }
            <ResponsePlot series={series} failed={failed} compact={compact}
                          yLabel={showDifference ? 'Error vs ideal (dB)' : 'Gain (dB)'}
                          compactYLabel={showDifference ? 'Δ dB' : 'dB'}/>
            {
                compact
                    ? <List dense aria-label="coefficients">
                        {
                            rows.map(r => (
                                <ListItem key={r.s.key} disableGutters divider>
                                    <Box sx={{mx: 1, display: 'flex'}}>{swatchOf(styleOf(r.s))}</Box>
                                    <ListItemText primary={r.s.label}
                                                  secondary={r.error ? `max error ${r.error}` : null}/>
                                </ListItem>
                            ))
                        }
                    </List>
                    : <TableContainer>
                        <Table size="small" aria-label="coefficients">
                            <TableHead>
                                <TableRow>
                                    <TableCell/>
                                    <TableCell>Coefficients</TableCell>
                                    <TableCell align="right">Max Error vs Ideal</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {
                                    rows.map(r => (
                                        <TableRow key={r.s.key}>
                                            <TableCell>{swatchOf(styleOf(r.s))}</TableCell>
                                            <TableCell>{r.s.label}</TableCell>
                                            <TableCell align="right">{r.error}</TableCell>
                                        </TableRow>
                                    ))
                                }
                            </TableBody>
                        </Table>
                    </TableContainer>
            }
        </>
    );
};

/**
 * Compares the selected entry with the other releases of the same title (matches) and/or with the coefficients
 * optimised for the selected device (when optimised and a deviceName is given).
 */
const CompareDialog = ({selectedEntry, matches = [], deviceName, optimised, onSelect, onClose, setError}) => {
    const theme = useTheme();
    // phones get a full screen dialog with a list instead of a table, and a chart without its legend
    const compact = useMediaQuery(theme.breakpoints.down('md'));
    const views = [
        matches.length > 0 ? RELEASES : null,
        optimised && deviceName ? OPTIMISATION : null
    ].filter(Boolean);
    const [selectedView, setView] = useState(views[0]);
    const view = views.includes(selectedView) ? selectedView : views[0];
    const [mode, setMode] = useState(RESPONSE);

    const select = id => {
        onSelect(id);
        onClose();
    };

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
                {
                    views.length > 1
                        ? <Tabs value={view} onChange={(e, v) => setView(v)} sx={{mb: 1}} aria-label="compare with">
                            <Tab value={RELEASES} label={`Releases (${matches.length})`}/>
                            <Tab value={OPTIMISATION} label="Optimised"/>
                        </Tabs>
                        : null
                }
                {
                    view === OPTIMISATION
                        ? <OptimisationComparison selectedEntry={selectedEntry} deviceName={deviceName} mode={mode}
                                                  setMode={setMode} compact={compact} setError={setError}/>
                        : <ReleaseComparison selectedEntry={selectedEntry} matches={matches} mode={mode}
                                             setMode={setMode} compact={compact} onSelect={select}
                                             setError={setError}/>
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
