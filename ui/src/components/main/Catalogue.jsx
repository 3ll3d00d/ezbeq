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

const CatalogueToolbar = () =>
            <GridToolbarContainer>
                <GridToolbarFilterButton />
                <GridToolbarDensitySelector />
            </GridToolbarContainer>;

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

const Catalogue = ({entries, setSelectedEntryId, selectedEntryId, useWide, showBottomNav}) => {
    const classes = useStyles();
    const catalogueGridColumns = [
        {
            field: 'author',
            headerName: '',
            flex: 0.1,
            renderCell: params => (
                <Avatar {...stringAvatar(params.row.author)} variant="rounded"/>
            )
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
            flex: 0.4
        },
        {
            field: 'sortTitle',
        },
        {
            field: 'edition',
            headerName: 'Edition'
        }
    ];
    if (entries.length > 0) {
        const bottomNavHeight = showBottomNav ? 40 : 0;
        const grid =
            <Grid item style={{
                height: `${Math.max(260, (window.innerHeight - 310 - bottomNavHeight) / (selectedEntryId === -1 || useWide ? 1 : 2))}px`,
                width: '100%'
            }}>
                <DataGrid rows={entries}
                          columns={catalogueGridColumns}
                          pageSize={50}
                          density={'compact'}
                          initialState={{ sorting: {sortModel: [{field: 'sortTitle', sort: 'asc'}]} }}
                          onRowSelectionModelChange={e => setSelectedEntryId(e[0])}
                          columnVisibilityModel={{sortTitle: false, edition: useWide}}
                          slots={{toolbar: CatalogueToolbar}}
                          slotProps={{toolbar: {printOptions: {disableToolbarButton: true}}}}
                />
            </Grid>;
        return useWide ? grid : <Grid container className={classes.noLeft}>{grid}</Grid>;
    } else {
        return null;
    }
};

export default Catalogue;