import { GoogleAIFileManager } from '@google/generative-ai/server'
import { join } from 'path'
import { unlinkSync } from 'fs'

const apiKey = process.env.GOOGLE_API_KEY || ''
const fileManager = new GoogleAIFileManager(apiKey)

export async function uploadToGemini(filePath: string, mimeType: string): Promise<string> {
    try {
        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType,
            displayName: 'Catalog',
        })
        const file = uploadResult.file
        console.log(`[GeminiUpload] Uploaded file ${file.displayName} as: ${file.uri}`)
        return file.uri
    } catch (error) {
        console.error('[GeminiUpload] Error uploading file:', error)
        throw error
    }
}
