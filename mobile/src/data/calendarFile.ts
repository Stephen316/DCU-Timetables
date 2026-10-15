import { File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';
import { MacShell } from './macShell';

/**
 * Hands an .ics file to whatever imports it. Safari on the iPhone opens a downloaded one
 * straight into Calendar's Add to Calendar, alerts and all; a desktop browser saves it to
 * open; the Mac app passes it to Calendar; the phone app offers it in the share sheet.
 * Call it from the tap itself: a browser refuses a download that isn't one.
 */
export async function openCalendarFile(ics: string, name: string): Promise<void> {
  if (MacShell.isPresent()) return MacShell.openCalendarFile(ics, name);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Long enough for the browser to have read it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(ics);
  await Share.share({ url: file.uri, title: name });
}
