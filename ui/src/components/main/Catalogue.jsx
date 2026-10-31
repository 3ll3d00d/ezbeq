import React, {useMemo, useState} from "react";
import {Avatar, Grid} from "@mui/material";
import {DataGrid} from "@mui/x-data-grid";
import {styled} from "@mui/material/styles";

const formatTitle = entry => {
    return entry.formattedTitle;
};

const UnpaddedDataGrid = styled(DataGrid)(({theme}) => ({
    '.MuiDataGrid-footerContainer': {
        minHeight: '36px'
    },
    '.MuiTablePagination-toolbar': {
        minHeight: '36px'
    },
    '.MuiTablePagination-displayedRows': {
        margin: '0px'
    }
}));

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
            bgcolor: stringToColor(name)
        },
        children: `${name.split(' ')[0][0]}`,
    };
}

const TITLE_SORT = [{field: 'sortTitle', sort: 'asc'}];

const Catalogue = ({entries, setSelectedEntryId, selectedEntryId, useWide, selectedDevice, rankedBySearch = false}) => {
    // while searching, entries arrive ordered by match quality so the grid must not re-sort them by
    // title. A header click still sorts as usual, until the search starts or is cleared
    const [userSort, setUserSort] = useState(null);
    const [sortFor, setSortFor] = useState(rankedBySearch);
    if (sortFor !== rankedBySearch) {
        setSortFor(rankedBySearch);
        setUserSort(null);
    }
    const sortModel = userSort ?? (rankedBySearch ? [] : TITLE_SORT);
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
    const topNav = 64;
    const gain = 56;
    const deviceRowHeight = 75;
    const deviceRows = selectedDevice && selectedDevice.slots ? Math.ceil(selectedDevice.slots.length / 2) : 0;
    const gainHeight = selectedDevice ? (['minidsp', 'camilladsp'].indexOf(selectedDevice.type) === -1 ? 0 : gain) : 0;
    const upperNavHeight = topNav + gainHeight + (deviceRows * deviceRowHeight);
    const bottomNavHeight = 24;
    // portrait mode so reduce space allocated to the grid
    const halfHeight = selectedEntryId !== -1 && !useWide;
    const gridHeight = Math.max(260, (window.innerHeight - upperNavHeight - bottomNavHeight) / (halfHeight ? 2 : 1));
    // console.debug(`showBottom: ${hasMultipleTabs} / ${selectedEntryId} / ${useWide} / ${deviceRows} * ${deviceRowHeight} / ${halfHeight}`);
    // console.debug(`numerator: ${window.innerHeight} - ${upperNavHeight} - ${bottomNavHeight} = ${window.innerHeight - upperNavHeight - bottomNavHeight}`);
    // console.debug(`denominator: ${halfHeight ? 2 : 1}`);
    // console.debug(`Grid Height: ${gridHeight}`);
    const authors = useMemo(() => new Set(entries.map(e => e.author)), [entries]);
    // controlled so a selection made elsewhere (compare, what's new) is highlighted here too, but only
    // with ids the grid has as it prunes (and reports as a deselection) any it doesn't
    const rowSelectionModel = useMemo(
        () => ({type: 'include', ids: new Set(entries.some(e => e.id === selectedEntryId) ? [selectedEntryId] : [])}),
        [entries, selectedEntryId]
    );
    const onRowSelectionModelChange = e => {
        const id = e.ids.values().next().value;
        if (id !== undefined) setSelectedEntryId(id);
    };
    const grid =
        <Grid style={{
            height: `${gridHeight}px`,
            width: '100%'
        }}>
            <UnpaddedDataGrid rows={entries}
                              columns={catalogueGridColumns}
                              pageSize={50}
                              density={'compact'}
                              sortModel={sortModel}
                              onSortModelChange={setUserSort}
                              rowSelectionModel={rowSelectionModel}
                              onRowSelectionModelChange={onRowSelectionModelChange}
                              columnVisibilityModel={{sortTitle: false, edition: useWide, author: authors.size > 1}}
                              sx={{p: 0, '& .avatar': { paddingLeft: '0px', paddingRight: '0px' }}}
                              disableColumnMenu={true}
                              getCellClassName={(params) => params.field === 'author' ? 'avatar' : ''}
                              hideFooterSelectedRowCount={true}
            />
        </Grid>;
    return useWide ? grid : <Grid container sx={{ml: 0}}>{grid}</Grid>;
};

export default Catalogue;