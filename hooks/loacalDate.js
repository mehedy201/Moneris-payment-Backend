const localDate = (date) => {
    const formatedDate =  new Date(date).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    })
    return formatedDate
};

module.exports = localDate;