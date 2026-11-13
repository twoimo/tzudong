import Foundation
import Vision
import ImageIO
import CoreGraphics

struct TextLine: Encodable {
    let text: String
    let confidence: Double
}

struct PreviewOcrPayload: Encodable {
    let engine: String
    let lines: [TextLine]
}

func fail(_ code: String) -> Never {
    let message = "{\"error\":\"\(code)\"}\n"
    FileHandle.standardError.write(Data(message.utf8))
    exit(2)
}

let maxBytes = 10 * 1024 * 1024 // 10MB
var inputData = Data()

if CommandLine.arguments.count >= 2 && CommandLine.arguments[1] != "-" {
    let path = CommandLine.arguments[1]
    let url = URL(fileURLWithPath: path)
    do {
        let handle = try FileHandle(forReadingFrom: url)
        inputData = handle.readData(ofLength: maxBytes + 1)
    } catch {
        fail("CANNOT_READ_INPUT_FILE")
    }
} else {
    inputData = FileHandle.standardInput.readData(ofLength: maxBytes + 1)
}

guard !inputData.isEmpty else {
    fail("EMPTY_INPUT")
}

guard inputData.count <= maxBytes else {
    fail("INPUT_TOO_LARGE")
}

guard let source = CGImageSourceCreateWithData(inputData as CFData, nil),
      CGImageSourceGetCount(source) == 1,
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0, width <= 8192, height <= 8192,
      width * height <= 24_000_000,
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("INVALID_IMAGE_DATA")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["ko-KR", "en-US"]

let orientationRaw = (properties[kCGImagePropertyOrientation] as? UInt32) ?? 1
let orientation = CGImagePropertyOrientation(rawValue: orientationRaw) ?? .up
let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
do {
    try handler.perform([request])
} catch {
    fail("OCR_RECOGNITION_FAILED")
}

let rawObservations = request.results ?? []
var lines: [TextLine] = []
for obs in rawObservations.prefix(256) {
    if let candidate = obs.topCandidates(1).first {
        let trimmed = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let bounded = String(trimmed.prefix(256))
            let conf = Double(round(Double(candidate.confidence) * 1000) / 1000)
            lines.append(TextLine(text: bounded, confidence: conf))
        }
    }
}

let payload = PreviewOcrPayload(engine: "macos-vision", lines: lines)
let encoder = JSONEncoder()
if let output = try? encoder.encode(payload) {
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data("\n".utf8))
} else {
    fail("SERIALIZATION_FAILED")
}
