const pushData = async (setter, getter) => {
    const data = await getter();
    setter(data);
};

export {
    pushData
};