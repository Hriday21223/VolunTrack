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

/// Guards a document preview (src/lib/screenGuard.js), only while it's open.
///
/// iOS can't block a screenshot, but it leaves out anything drawn inside a
/// password field's secure layer. enable() moves the app window's layer into
/// such a layer and puts a "Screenshots aren't allowed here" page behind it,
/// so a screenshot or recording shows that page instead of the document,
/// while the person on the phone sees the app as usual. disable() puts
/// everything back. This relies on how iOS draws password fields, not on a
/// public screenshot API, so every step checks what it finds and simply does
/// nothing if iOS changes; the web side still closes the preview after a
/// screenshot (`screenshotTaken`) and hides it while recording
/// (`captureChanged`).
@objc(ScreenGuardPlugin)
public class ScreenGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenGuardPlugin"
    public let jsName = "ScreenGuard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isCaptured", returnType: CAPPluginReturnPromise),
    ]

    // While enabled: the password field that owns the secure layer, the
    // page shown in screenshots, and where the window's layer came from.
    private var secureField: UITextField?
    private var placeholder: UIView?
    private weak var originalSuperlayer: CALayer?

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

    @objc func enable(_ call: CAPPluginCall) {
        let message = call.getString("message") ?? "Screenshots aren’t allowed here."
        DispatchQueue.main.async {
            self.hideFromCaptures(message: message)
            call.resolve()
        }
    }

    @objc func disable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.restore()
            call.resolve()
        }
    }

    @objc func isCaptured(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["captured": UIScreen.main.isCaptured])
        }
    }

    private func hideFromCaptures(message: String) {
        guard secureField == nil,
              let window = bridge?.viewController?.view.window,
              let superlayer = window.layer.superlayer else { return }

        let field = UITextField()
        field.isSecureTextEntry = true
        field.isUserInteractionEnabled = false
        window.addSubview(field)
        field.layoutIfNeeded()
        // The secure layer is the one drawn by the field's canvas view; find
        // it by name, else fall back to where iOS has kept it so far.
        let sublayers = field.layer.sublayers ?? []
        let secureLayer = sublayers.first(where: {
            String(describing: type(of: $0.delegate as AnyObject)).contains("CanvasView")
        }) ?? (sublayers.count > 0 ? sublayers[sublayers.count - 1] : nil)
        guard let secure = secureLayer else {
            field.removeFromSuperview()
            return
        }

        // The page a screenshot shows instead, behind the window.
        let page = UIView(frame: window.bounds)
        page.backgroundColor = UIColor(red: 0.04, green: 0.07, blue: 0.05, alpha: 1)
        let label = UILabel(frame: page.bounds.insetBy(dx: 32, dy: 0))
        label.text = message
        label.textColor = .white
        label.font = .systemFont(ofSize: 20, weight: .semibold)
        label.textAlignment = .center
        label.numberOfLines = 0
        page.addSubview(label)
        page.layoutIfNeeded()

        superlayer.insertSublayer(page.layer, below: window.layer)
        superlayer.addSublayer(field.layer)
        secure.addSublayer(window.layer)

        secureField = field
        placeholder = page
        originalSuperlayer = superlayer
    }

    private func restore() {
        guard let field = secureField,
              let window = bridge?.viewController?.view.window else { return }
        if let superlayer = originalSuperlayer {
            superlayer.addSublayer(window.layer)
        }
        field.layer.removeFromSuperlayer()
        field.removeFromSuperview()
        placeholder?.layer.removeFromSuperlayer()
        secureField = nil
        placeholder = nil
        originalSuperlayer = nil
    }
}
