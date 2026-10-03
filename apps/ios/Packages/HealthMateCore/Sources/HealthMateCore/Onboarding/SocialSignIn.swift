import Foundation

/// Whether the sign-in screen offers Continue with Apple / Google.
///
/// Only Preview mode can complete them today (it signs in to a sample account). Against a real
/// server the app can't get an ID token yet: Google needs the GoogleSignIn SDK and an iOS OAuth
/// client ID, and Sign in with Apple needs the paid Apple Developer Program's capability
/// (docs/phase2d-plan.md). Until then the buttons would always end in "isn't available", so
/// they're hidden. Same rule as the web (`socialSignInAvailable`).
public enum SocialSignIn {
    public static func isAvailable(serverIsPreview: Bool) -> Bool {
        serverIsPreview
    }
}
