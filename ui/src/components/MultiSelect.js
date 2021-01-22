import React from "react";
import TextField from "@material-ui/core/TextField";
import Autocomplete from "@material-ui/lab/Autocomplete";
import CheckBoxOutlineBlankIcon from "@material-ui/icons/CheckBoxOutlineBlank";
import CheckBoxIcon from "@material-ui/icons/CheckBox";
import {Checkbox} from "@material-ui/core";

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
        if (reason === "select-option" || reason === "remove-option") {
            onToggleOption && onToggleOption(value);
        } else if (reason === "clear") {
            onClearOptions && onClearOptions();
        } else if (reason === 'create-option') {
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

    const optionRenderer = (option, {selected}) => {
        return (
            <>
                <Checkbox
                    color="primary"
                    icon={<CheckBoxOutlineBlankIcon fontSize="small"/>}
                    checkedIcon={<CheckBoxIcon fontSize="small"/>}
                    style={{marginRight: 8}}
                    checked={selected}
                />
                <div style={getOptionStyle(option)}>{getOptionLabel(option)}</div>
            </>
        );
    };
    const inputRenderer = params => (
        <TextField {...params} label={label} placeholder={placeholder}/>
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
