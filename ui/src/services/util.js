import {useState} from "react";

const pushData = async (setter, getter, setError) => {
    try {
        const data = await getter();
        setter(data);
    } catch (error) {
        setError(error);
    }
};

const useLocalStorage = (key, initialValue) => {
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item).value : initialValue;
        } catch (error) {
            console.log(error);
            return initialValue;
        }
    });
    const setValue = (value) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify({value: valueToStore}));
        } catch (error) {
            console.log(error);
        }
    };
    return [storedValue, setValue];
}

export {
    pushData,
    useLocalStorage
};