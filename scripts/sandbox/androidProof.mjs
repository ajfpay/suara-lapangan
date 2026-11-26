export function parseCurlResponse(raw) {
    const split = raw.lastIndexOf("\n");
    const code = raw.slice(split + 1);
    if (split < 0 || !/^[1-5][0-9]{2}$/.test(code)) {
        throw new Error("Android request did not return a valid HTTP status");
    }
    return { status: Number(code), body: raw.slice(0, split) };
}

export function hasSecureSessionCookie(jar) {
    return jar.split(/\r?\n/).some((line) => {
        const parts = line.split("\t");
        return (
            parts.length === 7 &&
            parts[0].startsWith("#HttpOnly_") &&
            parts[3] === "TRUE" &&
            [
                "better-auth.session_token",
                "__Secure-better-auth.session_token",
            ].includes(parts[5]) &&
            parts[6].length > 0
        );
    });
}
