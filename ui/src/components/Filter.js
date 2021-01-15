import {makeStyles, useTheme} from "@material-ui/core/styles";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";
import Select from "@material-ui/core/Select";
import Input from "@material-ui/core/Input";
import MenuItem from "@material-ui/core/MenuItem";
import React from "react";
import {TextField} from "@material-ui/core";

const useStyles = makeStyles((theme) => ({
    formControl: {
        margin: theme.spacing(1),
        minWidth: 120,
        maxWidth: 300,
    },
    chips: {
        display: 'flex',
        flexWrap: 'wrap',
    },
    chip: {
        margin: 2,
    },
    noLabel: {
        marginTop: theme.spacing(3),
    },
}));

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
    PaperProps: {
        style: {
            maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
            width: 250,
        },
    },
};

function getStyles(v1, v2, theme) {
    return {
        fontWeight:
            v2.indexOf(v1) === -1
                ? theme.typography.fontWeightRegular
                : theme.typography.fontWeightMedium,
    };
}

const SelectValue = ({name, value, handleValueChange, values, multi = true}) => {
    const classes = useStyles();
    const theme = useTheme();
    return (
        <FormControl className={classes.formControl}>
            <InputLabel id={`${name}-label`}>{name}</InputLabel>
            <Select
                labelId={`${name}-label`}
                id={`${name}-select`}
                multiple={multi}
                value={value}
                onChange={handleValueChange}
                input={<Input />}
                MenuProps={MenuProps}>
                {values.map((v) => (
                    <MenuItem key={v} value={v} style={getStyles(v, value, theme)}>
                        {v}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};

const EnterValue = ({name, value, handleValueChange}) => {
    const classes = useStyles();
    const theme = useTheme();
    return (
        <FormControl className={classes.formControl}>
            <TextField
                id={`${name}-select`}
                label={name}
                value={value}
                onChange={handleValueChange}
                variant="filled"
                size={'small'}
            />
        </FormControl>
    );
};

export {
    SelectValue,
    EnterValue
};