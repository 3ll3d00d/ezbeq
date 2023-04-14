import React from "react";
import TextField from "@mui/material/TextField";
import { Autocomplete } from '@mui/material';
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import {Checkbox} from "@mui/material";

const MultiSelect = ({
                         items,
                         selectedValues,
                         label,
                         placeholder = '',
                         noOptionsText,
                         limitTags,
                         onToggleOption,
                         onCreateOption,
                         onClearOptions,
                         getOptionLabel = o => o,
                         isInView = v => true
                     }) => {
    const handleChange = (event, value, reason) => {
        if (reason === "selectOption" || reason === "removeOption") {
            onToggleOption && onToggleOption(value);
        } else if (reason === "clear") {
            onClearOptions && onClearOptions();
        } else if (reason === 'createOption') {
            onCreateOption && onCreateOption(value);
        } else {
            console.log(`Event: ${event} Value: ${value} Reason: ${reason}`);
        }
    };
    const getOptionStyle = o => {
        return {
            textDecoration: isInView(o) ? 'none' : 'line-through'
        };
    };

    const optionRenderer = (props, option, {selected}) => (
        <li {...props}>
            <Checkbox
                color="primary"
                icon={<CheckBoxOutlineBlankIcon fontSize="small"/>}
                checkedIcon={<CheckBoxIcon fontSize="small"/>}
                style={{marginRight: 8}}
                checked={selected}
            />
            <div style={getOptionStyle(option)}>{getOptionLabel(option)}</div>
        </li>
    );

    const inputRenderer = params => (
        <TextField variant="standard" {...params} label={label} placeholder={placeholder} />
    );
    return (
        <Autocomplete
            multiple
            size="small"
            disableCloseOnSelect
            freeSolo={(typeof onClearOptions !== 'undefined')}
            selectOnFocus
            handleHomeEndKeys
            limitTags={limitTags}
            options={items}
            value={selectedValues}
            noOptionsText={noOptionsText}
            onChange={handleChange}
            renderOption={optionRenderer}
            renderInput={inputRenderer}
            getOptionLabel={getOptionLabel}
        />
    );
};

MultiSelect.defaultProps = {
    limitTags: 5,
    items: [],
    selectedValues: []
};

export default MultiSelect;
