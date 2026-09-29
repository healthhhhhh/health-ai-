import AVFoundation
import HealthMateCore
import PhotosUI
import SwiftUI

/// Photo check: say what the photo shows, take it with guidance, review it, then send.
/// Mirrors the web flow at /reports/photo-check.
struct PhotoCheckView: View {
    let model: DocumentsViewModel
    var retake = false
    var onSubmitted: (DocumentRecord) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var step: Int
    @State private var purpose: ImagePurpose?
    @State private var item: PhotosPickerItem?
    @State private var imageData: Data?
    @State private var note = ""
    @State private var showCamera = false
    @State private var cameraDenied = false

    private static let steps = ["What it shows", "Take the photo", "Check and send"]

    init(model: DocumentsViewModel, initialPurpose: ImagePurpose? = nil, retake: Bool = false, onSubmitted: @escaping (DocumentRecord) -> Void) {
        self.model = model
        self.retake = retake
        self.onSubmitted = onSubmitted
        _purpose = State(initialValue: initialPurpose)
        _step = State(initialValue: initialPurpose == nil ? 0 : 1)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HM.Spacing.lg) {
                    // Never below anything else: a photo check is not the route for an emergency.
                    Label(PhotoCheck.getHelpNow, systemImage: "exclamationmark.triangle.fill")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textPrimary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.errorSoft))
                        .accessibilityLabel("When not to wait. \(PhotoCheck.getHelpNow)")
                    stepIndicator
                    if retake && step < 2 {
                        Label("The last photo wasn't clear enough to describe. The tips below help a retake work.", systemImage: "arrow.counterclockwise")
                            .font(.hmCaption)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.primarySoft))
                    }
                    switch step {
                    case 0: purposeStep
                    case 1: takeStep
                    default: reviewStep
                    }
                    if let error = model.errorMessage {
                        Label(error, systemImage: "exclamationmark.circle.fill")
                            .font(.hmCaption)
                            .foregroundStyle(HM.Colors.error)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.errorSoft))
                    }
                    DisclaimerView(text: "Photo checks describe what's visible and suggest next steps. They can't diagnose — a clinician needs to examine you for that.")
                }
                .padding(HM.Spacing.lg)
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .navigationTitle("Photo check")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(model.uploading) }
            }
            .interactiveDismissDisabled(model.uploading)
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { data in use(data) }.ignoresSafeArea()
            }
            .onChange(of: item) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) { use(data) } else { model.errorMessage = "We couldn't open that photo. Please try another one." }
                    self.item = nil
                }
            }
            .onAppear { model.errorMessage = nil }
        }
    }

    private var stepIndicator: some View {
        HStack(spacing: 8) {
            ForEach(Array(Self.steps.enumerated()), id: \.offset) { index, label in
                VStack(alignment: .leading, spacing: 6) {
                    Capsule().fill(index <= step ? HM.Colors.primaryFill : HM.Colors.cardMuted).frame(height: 5)
                    Text("\(index + 1). \(label)")
                        .font(index == step ? .hmMicro.weight(.semibold) : .hmMicro)
                        .foregroundStyle(index == step ? HM.Colors.textPrimary : HM.Colors.textSecondary)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(step + 1) of 3: \(Self.steps[step])")
    }

    private var purposeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("What does the photo show?").font(.hmSectionHeading)
            ForEach(ImagePurpose.allCases) { option in
                Button {
                    purpose = option
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.label).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                            Text(option.detail).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        }
                        Spacer()
                        Image(systemName: purpose == option ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(purpose == option ? HM.Colors.primary : HM.Colors.textMuted)
                    }
                    .padding(14)
                    .hmCard()
                    .overlay(RoundedRectangle(cornerRadius: HM.Radius.lg).strokeBorder(purpose == option ? HM.Colors.primary : .clear, lineWidth: 2))
                }
                .buttonStyle(PressableButtonStyle(scale: 0.98))
                .accessibilityAddTraits(purpose == option ? .isSelected : [])
            }
            Button("Continue") { step = 1 }
                .buttonStyle(.hmPrimary(fullWidth: true))
                .disabled(purpose == nil)
        }
    }

    @ViewBuilder
    private var takeStep: some View {
        if let purpose {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Take a clear photo").font(.hmSectionHeading)
                    HStack(spacing: 4) {
                        Text(purpose.label).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
                        Button("Change") { step = 0 }.font(.hmCaption.weight(.semibold))
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    ForEach([purpose.tip] + PhotoCheck.captureTips, id: \.self) { tip in
                        Label(tip, systemImage: "lightbulb").font(.hmCaption).foregroundStyle(HM.Colors.textPrimary)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.cardMuted))

                if cameraDenied {
                    PermissionPrimerView(
                        systemImage: "camera",
                        tone: .orange,
                        title: "Camera access is off",
                        message: "You can still choose a photo from your library.",
                        status: .denied,
                        deniedHelp: "Turn on Camera for HealthMate in Settings to take a photo here."
                    ) {
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        }
                        .buttonStyle(.hmSecondary)
                    }
                } else if CameraPicker.isAvailable {
                    Button { Task { await openCamera() } } label: {
                        Label("Take a photo", systemImage: "camera").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.hmPrimary(fullWidth: true))
                } else {
                    Text("This device has no camera — choose a photo from your library instead.")
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
                PhotosPicker(selection: $item, matching: .images) {
                    Label("Choose a photo", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity)
                }
                .buttonStyle(.hmSecondary)
                Text("Location and other details stored in the photo are removed before it's uploaded.")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
        }
    }

    @ViewBuilder
    private var reviewStep: some View {
        if let purpose, let imageData {
            VStack(alignment: .leading, spacing: 12) {
                Text("Check your photo").font(.hmSectionHeading)
                // Safety first: an emergency or urgent note shows guidance before anything is sent.
                if let escalation = PhotoCheck.escalation(forNote: note) {
                    EscalationCard(escalation: escalation)
                }
                if let image = UIImage(data: imageData) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 260)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: HM.Radius.md))
                        .accessibilityLabel("Your photo: \(purpose.label.lowercased())")
                }
                Text("\(purpose.label) · \(DocumentPresentation.byteSize(imageData.count))")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Anything else to mention? (optional)").font(.hmCaption.weight(.semibold))
                    TextField("e.g. itchy for 3 days, getting bigger", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: HM.Radius.md).fill(HM.Colors.card))
                        .onChange(of: note) { _, value in if value.count > 500 { note = String(value.prefix(500)) } }
                        .disabled(model.uploading)
                    Text("\(note.count)/500").font(.hmMicro).foregroundStyle(HM.Colors.textMuted).frame(maxWidth: .infinity, alignment: .trailing)
                }
                if model.uploading {
                    StepProgressView(steps: PhotoCheck.uploadSteps.map { .init(label: $0) }, current: 0)
                } else {
                    Button(model.errorMessage == nil ? "Check this photo" : "Try again") { Task { await send(purpose: purpose, data: imageData) } }
                        .buttonStyle(.hmPrimary(fullWidth: true))
                        .accessibilityIdentifier("sendPhotoCheck")
                    Button {
                        self.imageData = nil
                        step = 1
                    } label: {
                        Label("Retake", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.hmSecondary)
                }
            }
        }
    }

    private func use(_ data: Data) {
        model.errorMessage = nil
        imageData = data
        step = 2
    }

    private func openCamera() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: showCamera = true
        case .notDetermined:
            if await AVCaptureDevice.requestAccess(for: .video) { showCamera = true } else { cameraDenied = true }
        default: cameraDenied = true
        }
    }

    private func send(purpose: ImagePurpose, data: Data) async {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if let record = await model.submitPhoto(data: data, purpose: purpose, note: trimmed.isEmpty ? nil : trimmed) {
            dismiss()
            onSubmitted(record)
        }
    }
}
