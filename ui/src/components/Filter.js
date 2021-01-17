import {makeStyles, useTheme} from "@material-ui/core/styles";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";
import Select from "@material-ui/core/Select";
import Input from "@material-ui/core/Input";
import MenuItem from "@material-ui/core/MenuItem";
import React from "react";

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

function getStyles(v1, v2, theme, isInView) {
    return {
        fontWeight:
            v2.indexOf(v1) === -1
                ? (isInView ? theme.typography.fontWeightRegular : theme.typography.fontWeightLight)
                : theme.typography.fontWeightMedium,
        textDecoration: isInView ? 'none' : 'line-through'
    };
}

const SelectValue = ({name, value, handleValueChange, values, multi = true, isInView}) => {
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
                    <MenuItem key={v} value={v} style={getStyles(v, value, theme, isInView(v))}>
                        {v}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};

export {
    SelectValue
};