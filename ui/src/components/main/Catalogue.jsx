import {makeStyles} from "@mui/styles";
import React from "react";
import {Avatar, Grid} from "@mui/material";
import {DataGrid, GridToolbarContainer, GridToolbarDensitySelector, GridToolbarFilterButton} from "@mui/x-data-grid";

const useStyles = makeStyles((theme) => ({
    noLeft: {
        marginLeft: '0px'
    }
}));

const formatTitle = entry => {
    return entry.formattedTitle;
};

const stringToColor = string => {
    let hash = 0;
    let i;

    /* eslint-disable no-bitwise */
    for (i = 0; i < string.length; i += 1) {
        hash = string.charCodeAt(i) + ((hash << 5) - hash);
    }

    let color = '#';

    for (i = 0; i < 3; i += 1) {
        const value = (hash >> (i * 8)) & 0xff;
        color += `00${value.toString(16)}`.slice(-2);
    }
    /* eslint-enable no-bitwise */

    return color;
}

const stringAvatar = name => {
    return {
        sx: {
            bgcolor: stringToColor(name),
        },
        children: `${name.split(' ')[0][0]}`,
    };
}

const Catalogue = ({entries, setSelectedEntryId, selectedEntryId, useWide, showBottomNav, device}) => {
    const classes = useStyles();
    const catalogueGridColumns = [
        {
            field: 'author',
            headerName: '',
            flex: 0.1,
            renderCell: params => (
                <Avatar {...stringAvatar(params.row.author)} variant="rounded"/>
            ),
            sortable: false
        },
        {
            field: 'title',
            headerName: 'Title',
            flex: 0.6,
            renderCell: params => (
                params.row.url
                    ? <a href={params.row.avsUrl} target='_beq'>{formatTitle(params.row)}</a>
                    : formatTitle(params.row)
            )
        },
        {
            field: 'audioTypes',
            headerName: 'Audio Type',
            flex: 0.4,
            sortable: false
        },
        {
            field: 'sortTitle',
        },
        {
            field: 'edition',
            headerName: 'Edition',
            sortable: false
        }
    ];
    if (entries.length > 0) {
        const topNav = 64;
        const gain = 56;
        const deviceRowHeight = 59;
        const deviceRows = device && device.slots ? Math.ceil(device.slots.length / 2) : 0;
        const upperNavHeight = topNav + (showBottomNav ? gain : 0) + (deviceRows * deviceRowHeight);
        const bottomNavShouldBeVisible = showBottomNav || selectedEntryId === -1;
        const bottomNavHeight = bottomNavShouldBeVisible ? (showBottomNav ? 80 : 24) : 0;
        // portrait mode so reduce space allocated to the grid
        const halfHeight = selectedEntryId !== -1 && !useWide;
        const gridHeight = Math.max(260, (window.innerHeight - upperNavHeight - bottomNavHeight) / (halfHeight ? 2 : 1));
        console.debug(`showBottom: ${showBottomNav} / ${selectedEntryId} / ${useWide} / ${deviceRows} * ${deviceRowHeight} / ${halfHeight}`);
        console.debug(`numerator: ${window.innerHeight} - ${upperNavHeight} - ${bottomNavHeight} = ${window.innerHeight - upperNavHeight - bottomNavHeight}`);
        console.debug(`denominator: ${halfHeight ? 2 : 1}`);
        console.debug(`Grid Height: ${gridHeight}`);
        const grid =
            <Grid item style={{
                height: `${gridHeight}px`,
                width: '100%'
            }}>
                <DataGrid rows={entries}
                          columns={catalogueGridColumns}
                          pageSize={50}
                          density={'compact'}
                          initialState={{ sorting: {sortModel: [{field: 'sortTitle', sort: 'asc'}]} }}
                          onRowSelectionModelChange={e => setSelectedEntryId(e[0])}
                          columnVisibilityModel={{sortTitle: false, edition: useWide}}
                />
            </Grid>;
        return useWide ? grid : <Grid container className={classes.noLeft}>{grid}</Grid>;
    } else {
        return null;
    }
};

export default Catalogue;