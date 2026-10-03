import Foundation

/// How consent screens refer to whoever receives data for AI processing: "our AI provider",
/// followed by the company's name when the server reports it (`/v1/meta` `ai.recipients`).
/// Preview mode and older servers report none. Used mid-sentence:
/// "…to our AI provider, Anthropic, to answer you." Same wording as the web (`aiProviderPhrase`).
public enum AIProviderPhrase {
    public static func phrase(recipients: [String]?) -> String {
        let names = (recipients ?? []).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard let last = names.last else { return "our AI provider" }
        let list = names.count == 1 ? last : "\(names.dropLast().joined(separator: ", ")) and \(last)"
        return "our AI \(names.count == 1 ? "provider" : "providers"), \(list),"
    }
}
