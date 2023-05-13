import {makeStyles} from "@mui/styles";
import React from "react";
import {Grid} from "@mui/material";
import {DataGrid, GridToolbar} from "@mui/x-data-grid";

const useStyles = makeStyles((theme) => ({
    noLeft: {
        marginLeft: '0px'
    }
}));

const formatTitle = entry => {
    return entry.formattedTitle;
};

const Catalogue = ({entries, setSelectedEntryId, selectedEntryId, useWide, showBottomNav}) => {
    const classes = useStyles();
    const catalogueGridColumns = [
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
                          sortModel={[
                              {
                                  field: 'sortTitle',
                                  sort: 'asc',
                              },
                          ]}
                          onRowSelectionModelChange={e => {
                              console.log(e[0]);
                              setSelectedEntryId(e[0]);
                          }}
                          columnVisibilityModel={{
                              sortTitle: false,
                              edition: useWide,
                          }}
                          slots={{
                              toolbar: GridToolbar
                          }}
                          slotProps={{ toolbar: { printOptions: { disableToolbarButton: true } } }}
                />
            </Grid>;
        return useWide ? grid : <Grid container className={classes.noLeft}>{grid}</Grid>;
    } else {
        return null;
    }
};

export default Catalogue;