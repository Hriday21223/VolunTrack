import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// Plugins that live in this app (not an npm package) are registered here.
// They're kept in this file because it's already part of the Xcode project.
class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenGuardPlugin())
    }
}

/// Guards a document preview (src/lib/screenGuard.js). iOS can't block a
/// screenshot, only report it afterwards, so the web side closes the preview
/// on `screenshotTaken`, and hides it while `captureChanged` says the screen
/// is being recorded or mirrored. enable()/disable() are Android's
/// screenshot block; here they do nothing.
@objc(ScreenGuardPlugin)
public class ScreenGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenGuardPlugin"
    public let jsName = "ScreenGuard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isCaptured", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(screenshotTaken),
            name: UIApplication.userDidTakeScreenshotNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(captureChanged),
            name: UIScreen.capturedDidChangeNotification, object: nil)
    }

    @objc func screenshotTaken() {
        notifyListeners("screenshotTaken", data: [:])
    }

    @objc func captureChanged() {
        notifyListeners("captureChanged", data: ["captured": UIScreen.main.isCaptured])
    }

    @objc func enable(_ call: CAPPluginCall) { call.resolve() }
    @objc func disable(_ call: CAPPluginCall) { call.resolve() }

    @objc func isCaptured(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["captured": UIScreen.main.isCaptured])
        }
    }
}
