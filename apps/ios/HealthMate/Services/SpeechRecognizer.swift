import AVFoundation
import Foundation
import Observation
import Speech

/// Live speech-to-text for voice questions. Prefers on-device recognition so
/// audio doesn't leave the phone when the device supports it. Audio is never
/// stored; only the transcript (which the person reviews) is used.
@MainActor
@Observable
final class SpeechRecognizer {
    enum State: Equatable {
        case idle
        case requestingPermission
        case listening
        case denied(String)
        case failed(String)
    }

    private(set) var state: State = .idle
    var transcript = ""
    /// 0…1 input level for the waveform.
    private(set) var level: Double = 0

    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    var isListening: Bool { state == .listening }

    func start() async {
        guard state != .listening else { return }
        state = .requestingPermission
        guard await Self.requestSpeechPermission() else {
            state = .denied("Allow Speech Recognition for HealthMate in Settings to ask by voice.")
            return
        }
        guard await AVAudioApplication.requestRecordPermission() else {
            state = .denied("Allow microphone access for HealthMate in Settings to ask by voice.")
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            state = .failed("Voice input isn't available right now. You can type your question instead.")
            return
        }
        do {
            try begin(with: recognizer)
            state = .listening
        } catch {
            stopAudio()
            state = .failed("We couldn't start the microphone. You can type your question instead.")
        }
    }

    func stop() {
        guard state == .listening else { return }
        request?.endAudio()
        stopAudio()
        state = .idle
    }

    private func begin(with recognizer: SFSpeechRecognizer) throws {
        task?.cancel()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        request.addsPunctuation = true
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tapBlock(request: request) { [weak self] level in
            Task { @MainActor in self?.level = level }
        })
        audioEngine.prepare()
        try audioEngine.start()

        task = recognizer.recognitionTask(with: request, resultHandler: Self.resultHandler { [weak self] text, finished in
            Task { @MainActor in
                guard let self else { return }
                if let text { self.transcript = text }
                if finished {
                    self.stopAudio()
                    if self.state == .listening { self.state = .idle }
                }
            }
        })
    }

    // Built outside the main actor: these run on audio / recognition threads.
    private nonisolated static func tapBlock(request: SFSpeechAudioBufferRecognitionRequest, onLevel: @escaping @Sendable (Double) -> Void) -> AVAudioNodeTapBlock {
        { buffer, _ in
            request.append(buffer)
            onLevel(rms(buffer))
        }
    }

    private nonisolated static func resultHandler(_ update: @escaping @Sendable (String?, Bool) -> Void) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, error in
            update(result?.bestTranscription.formattedString, error != nil || (result?.isFinal ?? false))
        }
    }

    private func stopAudio() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        task?.finish()
        task = nil
        request = nil
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private nonisolated static func requestSpeechPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
    }

    private nonisolated static func rms(_ buffer: AVAudioPCMBuffer) -> Double {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(buffer.frameLength))
        return min(1, Double(rms) * 12)
    }
}

/// Reads assistant answers aloud on request.
@MainActor
@Observable
final class SpeechReader: NSObject, AVSpeechSynthesizerDelegate {
    private(set) var speakingID: String?
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func toggle(_ text: String, id: String) {
        if speakingID == id {
            synthesizer.stopSpeaking(at: .immediate)
            speakingID = nil
            return
        }
        synthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.language.languageCode?.identifier)
        speakingID = id
        synthesizer.speak(utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.speakingID = nil }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.speakingID = nil }
    }
}
