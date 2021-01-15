import { useState } from 'react'

export const useValueChange = (startingValue = null) => {
    const [value, setValue] = useState(startingValue !== null ? startingValue : []);

    const handleChange = (event) => {
        setValue(event.target.value);
    };

    return [value, handleChange];
};