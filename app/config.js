/* Set your Umbrel Stremio streaming-server URL here (no trailing slash), e.g. http://umbrel.local:11470
   It can also be changed later in Stremio Settings > Streaming server. */
window.STREMIO_SERVER_URL = 'http://umbrel.local:11470';
/* UI zoom for TV (1.5 = 150%). Adjust live with the remote: Red = smaller, Green = larger, Yellow = reset. */
window.STREMIO_TV_ZOOM = 1.5;
/* Video buffering for the built-in HLS player. Larger = fewer stutters but more TV memory. */
window.STREMIO_BUFFER_SECONDS = 90;   // seconds of video to buffer ahead
window.STREMIO_BUFFER_MB = 100;       // max buffer size in MB (lower if the app restarts for memory)
