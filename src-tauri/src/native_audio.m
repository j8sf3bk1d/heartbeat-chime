#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <dispatch/dispatch.h>

// Diagnostic-only playback. Copy input bytes and retain each player until its
// expected completion so concurrent tests/chimes do not cut one another off.
int hb_native_audio_play(const unsigned char *bytes, size_t length, double volume, double *started_ms, double *duration_ms) {
  @autoreleasepool {
    if (!bytes || !length || !started_ms || !duration_ms) return 0;
    NSData *data = [NSData dataWithBytes:bytes length:length];
    NSError *error = nil;
    AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithData:data error:&error];
    if (!player || ![player prepareToPlay]) return 0;
    player.volume = (float)volume;
    static NSMutableSet<AVAudioPlayer *> *active;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ active = [NSMutableSet set]; });
    @synchronized(active) { [active addObject:player]; }
    *started_ms = NSDate.date.timeIntervalSince1970 * 1000.0;
    if (![player play]) { @synchronized(active) { [active removeObject:player]; } return 0; }
    *duration_ms = player.duration * 1000.0;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((player.duration + 2.0) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      @synchronized(active) { [active removeObject:player]; }
    });
    return 1;
  }
}
