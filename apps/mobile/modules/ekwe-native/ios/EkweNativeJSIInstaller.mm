#import "EkweNativeJSIInstaller.h"
#import "EkweAudioBridge.h"
#import <jsi/jsi.h>

void installEkweNativeJSI(void *runtimePointer) {
  facebook::jsi::Runtime &runtime = *static_cast<facebook::jsi::Runtime *>(runtimePointer);

  auto hostFn = facebook::jsi::Function::createFromHostFunction(
      runtime,
      facebook::jsi::PropNameID::forAscii(runtime, "ekweNativeGetAmplitude"),
      0,
      [](facebook::jsi::Runtime &rt,
         const facebook::jsi::Value &thisVal,
         const facebook::jsi::Value *args,
         size_t count) -> facebook::jsi::Value {
        float rms = [EkweAudioBridge getAmplitude];
        return facebook::jsi::Value(static_cast<double>(rms));
      });

  runtime.global().setProperty(
      runtime, "ekweNativeGetAmplitude", std::move(hostFn));
}
