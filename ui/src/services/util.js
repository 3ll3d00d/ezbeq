const pushData = async (setter, getter, setError) => {
    try {
        const data = await getter();
        setter(data);
    } catch (error) {
        setError(error);
    }
};

export {
    pushData
};