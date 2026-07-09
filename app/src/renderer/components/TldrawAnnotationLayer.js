import React, { useCallback, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Box,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  Tldraw,
} from 'tldraw'
import { getAssetUrlsByMetaUrl } from '@tldraw/assets/urls'
import 'tldraw/tldraw.css'

const LOCKED_ANNOTATION_CAMERA_OPTIONS = Object.freeze({
  isLocked: true,
  panSpeed: 0,
  wheelBehavior: 'none',
  zoomSpeed: 0,
  zoomSteps: [1],
})

let cachedAssetUrls
let assetUrlsResolved = false

function resolveTldrawAssetUrls() {
  if (assetUrlsResolved) return cachedAssetUrls
  assetUrlsResolved = true
  try {
    cachedAssetUrls = getAssetUrlsByMetaUrl()
  } catch (error) {
    console.warn('tldraw asset urls unavailable', error)
    cachedAssetUrls = undefined
  }
  return cachedAssetUrls
}

function imageKey(imageSrc, imageLabel) {
  return `${imageSrc || ''}::${imageLabel || ''}`
}

function clearCurrentPage(editor) {
  if (!editor) return
  const shapeIds = Array.from(editor.getCurrentPageShapeIds())
  if (shapeIds.length) editor.deleteShapes(shapeIds)
  editor.setCurrentTool('select')
  resetCamera(editor)
}

function resetCamera(editor) {
  if (!editor) return
  editor.setCameraOptions(LOCKED_ANNOTATION_CAMERA_OPTIONS)
  editor.setCamera({ x: 0, y: 0, z: 1 }, { animation: { duration: 0 }, force: true })
}

async function exportAnnotation(editor) {
  if (!editor) throw new Error('标注画布尚未准备好')
  const shapeIds = Array.from(editor.getCurrentPageShapeIds())
  if (!shapeIds.length) return ''
  const rect = editor.getContainer()?.getBoundingClientRect?.()
  const bounds = rect?.width && rect?.height
    ? new Box(0, 0, rect.width, rect.height)
    : editor.getShapesPageBounds(shapeIds)
  const exportResult = await editor.toImageDataUrl(shapeIds, {
    bounds,
    background: false,
    darkMode: false,
    format: 'png',
    padding: 0,
    pixelRatio: 2,
  })
  return exportResult?.url || ''
}

function AnnotationReactApp({
  imageSrc,
  imageLabel,
  activeTool,
  annotationColor,
  clearNonce,
  exportNonce,
  onExport,
  onError,
  onReady,
}) {
  const editorRef = useRef(null)
  const gestureTargetRef = useRef(null)
  const sourceKeyRef = useRef('')
  const pendingExportNonceRef = useRef(0)
  const callbackRef = useRef({ onExport, onError, onReady })
  const assetUrls = resolveTldrawAssetUrls()

  useEffect(() => {
    callbackRef.current = { onExport, onError, onReady }
  }, [onError, onExport, onReady])

  const resetLayer = useCallback((editor) => {
    if (!editor) return
    clearCurrentPage(editor)
    callbackRef.current.onReady?.()
  }, [])

  function stopCameraGesture(event) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation?.()
    resetCamera(editorRef.current)
  }

  useEffect(() => {
    const target = gestureTargetRef.current
    if (!target) return undefined
    target.addEventListener('wheel', stopCameraGesture, { capture: true, passive: false })
    target.addEventListener('gesturestart', stopCameraGesture, { capture: true, passive: false })
    target.addEventListener('gesturechange', stopCameraGesture, { capture: true, passive: false })
    target.addEventListener('gestureend', stopCameraGesture, { capture: true, passive: false })
    return () => {
      target.removeEventListener('wheel', stopCameraGesture, { capture: true })
      target.removeEventListener('gesturestart', stopCameraGesture, { capture: true })
      target.removeEventListener('gesturechange', stopCameraGesture, { capture: true })
      target.removeEventListener('gestureend', stopCameraGesture, { capture: true })
    }
  }, [stopCameraGesture])

  const applyAnnotationStyle = useCallback((editor) => {
    if (!editor || !annotationColor) return
    editor.setStyleForNextShapes(DefaultColorStyle, annotationColor)
    editor.setStyleForNextShapes(DefaultDashStyle, 'draw')
    editor.setStyleForNextShapes(DefaultSizeStyle, 'l')
    const selectedShapeIds = Array.from(editor.getSelectedShapeIds?.() || [])
    if (selectedShapeIds.length) editor.setStyleForSelectedShapes(DefaultColorStyle, annotationColor)
  }, [annotationColor])

  const runExport = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return false
    void exportAnnotation(editor)
      .then((dataUrl) => callbackRef.current.onExport?.(dataUrl))
      .catch((error) => callbackRef.current.onError?.(error))
    return true
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const nextKey = imageKey(imageSrc, imageLabel)
    if (sourceKeyRef.current === nextKey) return
    sourceKeyRef.current = nextKey
    resetLayer(editor)
  }, [imageLabel, imageSrc, resetLayer])

  useEffect(() => {
    if (!clearNonce) return
    resetLayer(editorRef.current)
  }, [clearNonce, resetLayer])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    applyAnnotationStyle(editor)
    editor.setCurrentTool(activeTool || 'select')
  }, [activeTool, applyAnnotationStyle])

  useEffect(() => {
    applyAnnotationStyle(editorRef.current)
  }, [annotationColor, applyAnnotationStyle])

  useEffect(() => {
    if (!exportNonce) return
    pendingExportNonceRef.current = exportNonce
    if (runExport()) pendingExportNonceRef.current = 0
  }, [exportNonce, runExport])

  return React.createElement(
    'div',
    { className: 'aiw-tldraw-root', ref: gestureTargetRef },
    React.createElement(Tldraw, {
      ...(assetUrls ? { assetUrls } : {}),
      hideUi: true,
      inferDarkMode: false,
      options: {
        camera: LOCKED_ANNOTATION_CAMERA_OPTIONS,
        rightClickPanning: false,
        spacebarPanning: false,
      },
      onMount: (editor) => {
        editorRef.current = editor
        editor.setCameraOptions(LOCKED_ANNOTATION_CAMERA_OPTIONS)
        sourceKeyRef.current = imageKey(imageSrc, imageLabel)
        resetLayer(editor)
        applyAnnotationStyle(editor)
        if (pendingExportNonceRef.current && runExport()) pendingExportNonceRef.current = 0
      },
    }),
  )
}

export default defineComponent({
  name: 'TldrawAnnotationLayer',
  props: {
    imageSrc: { type: String, default: '' },
    imageLabel: { type: String, default: '' },
    activeTool: { type: String, default: '' },
    annotationColor: { type: String, default: 'red' },
    clearNonce: { type: Number, default: 0 },
    exportNonce: { type: Number, default: 0 },
  },
  emits: ['export-annotation', 'error', 'ready'],
  setup(props, { emit }) {
    const host = ref(null)
    let root = null

    const renderReact = () => {
      if (!host.value || !root) return
      root.render(React.createElement(AnnotationReactApp, {
        imageSrc: props.imageSrc,
        imageLabel: props.imageLabel,
        activeTool: props.activeTool,
        annotationColor: props.annotationColor,
        clearNonce: props.clearNonce,
        exportNonce: props.exportNonce,
        onExport: (dataUrl) => emit('export-annotation', dataUrl),
        onError: (error) => emit('error', error?.message || String(error)),
        onReady: () => emit('ready'),
      }))
    }

    onMounted(() => {
      root = createRoot(host.value)
      renderReact()
    })

    onBeforeUnmount(() => {
      if (root) root.unmount()
      root = null
    })

    watch(() => [
      props.imageSrc,
      props.imageLabel,
      props.activeTool,
      props.annotationColor,
      props.clearNonce,
      props.exportNonce,
    ], renderReact)

    return () => h('div', { ref: host, class: 'aiw-tldraw-host' })
  },
})
