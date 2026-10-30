// Background tasks must be defined before anything renders: a headless start
// (Android running a scheduled refresh with the app closed) never loads the routes.
import './src/feeds/background';
import 'expo-router/entry';
