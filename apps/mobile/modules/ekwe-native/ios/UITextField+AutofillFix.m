#import "UITextField+AutofillFix.h"
#import <objc/runtime.h>

@implementation UITextField (AutofillFix)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    SEL selector = NSSelectorFromString(@"_autofillBackgroundColor");
    Method method = class_getInstanceMethod([UITextField class], selector);
    if (method) {
      IMP replacement = imp_implementationWithBlock(^UIColor*(UITextField* _self) {
        return [UIColor clearColor];
      });
      method_setImplementation(method, replacement);
    }
  });
}

@end
