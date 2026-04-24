(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.TimezoneUtils = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const EASTERN_TIME_ZONE = 'America/New_York';

    function isoToEasternDateTimeLocal(isoString) {
        if (!isoString) return '';

        const parts = new Intl.DateTimeFormat('sv-SE', {
            timeZone: EASTERN_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date(isoString));

        const values = Object.fromEntries(
            parts
                .filter(part => part.type !== 'literal')
                .map(part => [part.type, part.value])
        );

        return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
    }

    function getTimeZoneOffsetMinutes(date, timeZone = EASTERN_TIME_ZONE) {
        const timeZoneName = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || 'GMT-0';

        const match = timeZoneName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
        if (!match) return 0;

        const [, sign, hours, minutes = '00'] = match;
        const totalMinutes = (parseInt(hours, 10) * 60) + parseInt(minutes, 10);
        return sign === '+' ? totalMinutes : -totalMinutes;
    }

    function easternDateTimeLocalToIso(dateTimeLocal) {
        if (!dateTimeLocal || typeof dateTimeLocal !== 'string') {
            throw new Error('Invalid datetime-local value');
        }

        const [datePart, timePart] = dateTimeLocal.split('T');
        if (!datePart || !timePart) {
            throw new Error('Invalid datetime-local value');
        }

        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);

        if ([year, month, day, hour, minute].some(Number.isNaN)) {
            throw new Error('Invalid datetime-local value');
        }

        const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute);

        let candidateDate = new Date(localAsUtcMs);
        let offsetMinutes = getTimeZoneOffsetMinutes(candidateDate);
        let utcMs = localAsUtcMs - (offsetMinutes * 60_000);

        candidateDate = new Date(utcMs);
        const correctedOffsetMinutes = getTimeZoneOffsetMinutes(candidateDate);
        if (correctedOffsetMinutes !== offsetMinutes) {
            utcMs = localAsUtcMs - (correctedOffsetMinutes * 60_000);
        }

        return new Date(utcMs).toISOString();
    }

    return {
        isoToEasternDateTimeLocal,
        easternDateTimeLocalToIso
    };
});
