import { isPushEndpoint } from './push-hosts.js';

describe('Services push autorisés', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91b',
    'https://fcm.googleapis.com/wp/dQw4w9WgXcQ',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB',
    'https://updates-autopush.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
    'https://web.push.apple.com/QGuQyavXutnMH6M4Eq',
    'https://api.push.apple.com/3/device/abc',
    'https://FCM.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ])('accepte %s', (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['suffixe piégé', 'https://fcm.googleapis.com.evil.com/fcm/send/abc'],
    ['préfixe collé', 'https://evilfcm.googleapis.com/fcm/send/abc'],
    ['préfixe collé (suffixe)', 'https://evilnotify.windows.com/w/'],
    ['suffixe nu', 'https://push.services.mozilla.com/wpush/v2/abc'],
    ['point final', 'https://fcm.googleapis.com./fcm/send/abc'],
    ['autre port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['identifiants', 'https://user:pass@fcm.googleapis.com/fcm/send/abc'],
    ['hôte arbitraire', 'https://push.test/abc'],
    ['IPv4', 'https://169.254.169.254/latest/meta-data'],
    ['IPv6', 'https://[::1]/abc'],
    ['localhost', 'https://localhost/abc'],
    ['adresse invalide', 'pas une adresse'],
    ['autre protocole', 'file:///etc/passwd'],
  ])('refuse : %s', (_, endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(false);
  });
});
