/**
 * Fonts for the app and for anything rendered into a document or an icon.
 *
 * Source Serif 4 sets the headings: paperwork is set in a serif, and at 40px+
 * a serif holds its shape in glare better than a geometric sans. IBM Plex Sans
 * is the body and interface face, chosen for its open digits — prices and
 * quantities are read digit by digit on the confirmation screen.
 *
 * Both are self-hosted from @fontsource, not fetched from Google Fonts at
 * build time: a build has to work offline, and a font request is a third party
 * between the user and the screen.
 */
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/700.css";
