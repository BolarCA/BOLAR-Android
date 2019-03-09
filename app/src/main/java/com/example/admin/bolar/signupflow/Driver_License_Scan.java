package com.example.admin.bolar.signupflow;

import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Point;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.support.annotation.NonNull;
import android.support.v4.content.FileProvider;
import android.support.v7.app.AlertDialog;
import android.support.v7.app.AppCompatActivity;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.Toast;
import com.example.admin.bolar.R;

import com.example.admin.bolar.licensehelper.BarcodeInfo;
import com.example.admin.bolar.tenantmain.TenantHome;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.SetOptions;
import com.google.firebase.ml.vision.FirebaseVision;
import com.google.firebase.ml.vision.barcode.FirebaseVisionBarcode;
import com.google.firebase.ml.vision.barcode.FirebaseVisionBarcodeDetector;
import com.google.firebase.ml.vision.barcode.FirebaseVisionBarcodeDetectorOptions;
import com.google.firebase.ml.vision.common.FirebaseVisionImage;

import java.io.File;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


public class Driver_License_Scan extends AppCompatActivity {

    private final String APP_TAG = "MyCustomApp";
    private final static int CAPTURE_IMAGE_ACTIVITY_REQUEST_CODE = 1034;
    private String photoFileName = "photo.jpg";
    private File photoFile;
    private Button takePic;
    private FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
    private BarcodeInfo info;
    private String first;
    private String last;
    private String type;

    FirebaseFirestore db = FirebaseFirestore.getInstance();
    //configures model for only this specific type of barcode
    FirebaseVisionBarcodeDetectorOptions options =
            new FirebaseVisionBarcodeDetectorOptions.Builder()
                    .setBarcodeFormats(
                            FirebaseVisionBarcode.FORMAT_PDF417)
                    .build();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        FirebaseApp.initializeApp(this);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_driver__license__scan);
        takePic = findViewById(R.id.button);

        Intent intent = getIntent();
        first = intent.getStringExtra("firstName");
        last = intent.getStringExtra("lastName");
        type = intent.getStringExtra("type");

        onLaunchCamera();
    }

    //When they click Capture
    public void onLaunchCamera() {
        takePic.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                // create Intent to take a picture and return control to the calling application
                Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                // Create a File reference to access to future access
                photoFile = getPhotoFileUri(photoFileName);

                // wrap File object into a content provider
                // required for API >= 24
                // See https://guides.codepath.com/android/Sharing-Content-with-Intents#sharing-files-with-api-24-or-higher
                Uri fileProvider = FileProvider.getUriForFile(Driver_License_Scan.this, "com.codepath.fileprovider", photoFile);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, fileProvider);

                // If you call startActivityForResult() using an intent that no app can handle, your app will crash.
                // So as long as the result is not null, it's safe to use the intent.
                if (intent.resolveActivity(getPackageManager()) != null) {
                    // Start the image capture intent to take photo
                    startActivityForResult(intent, CAPTURE_IMAGE_ACTIVITY_REQUEST_CODE);
                }
            }
        });
    }

    // Returns the File for a photo stored on disk given the fileName
    public File getPhotoFileUri(String fileName) {
        // Get safe storage directory for photos
        // Use `getExternalFilesDir` on Context to access package-specific directories.
        // This way, we don't need to request external read/write runtime permissions.
        File mediaStorageDir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), APP_TAG);

        // Create the storage directory if it does not exist
        if (!mediaStorageDir.exists() && !mediaStorageDir.mkdirs()){
            Log.d(APP_TAG, "failed to create directory");
        }

        // Return the file target for the photo based on filename
        File file = new File(mediaStorageDir.getPath() + File.separator + fileName);

        return file;
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == CAPTURE_IMAGE_ACTIVITY_REQUEST_CODE) {
            if (resultCode == RESULT_OK) {
                // by this point we have the camera photo on disk
                Bitmap takenImage = BitmapFactory.decodeFile(photoFile.getAbsolutePath());

                scanBarcode(takenImage);

                // RESIZE BITMAP, see section below
                // Load the taken image into a preview
                //ImageView ivPreview = (ImageView) findViewById(R.id.imageView);
                //ivPreview.setImageBitmap(takenImage);
            } else { // Result was a failure
                Toast.makeText(this, "Picture wasn't taken!", Toast.LENGTH_SHORT).show();
            }
        }
    }

    //Decodes barcode
    public void scanBarcode(Bitmap bitmap){
        //create firebaseVisionImage object from a Bitmap object //image must be upright with no rotation required
        FirebaseVisionImage image = FirebaseVisionImage.fromBitmap(bitmap);
        //get an instance of FirebaseVisionBarcodeDetector
        FirebaseVisionBarcodeDetector barcodeDetector = FirebaseVision.getInstance().getVisionBarcodeDetector(options);
        //pass image into detectInImage method
        Task<List<FirebaseVisionBarcode>> result = barcodeDetector.detectInImage(image)
                .addOnSuccessListener(new OnSuccessListener<List<FirebaseVisionBarcode>>() {
                    @Override
                    public void onSuccess(List<FirebaseVisionBarcode> barcodes) {
                        // Task completed successfully
                        for (FirebaseVisionBarcode barcode: barcodes) {
                            Rect bounds = barcode.getBoundingBox();
                            Point[] corners = barcode.getCornerPoints();

                            String rawValue = barcode.getRawValue();
                            int valueType = barcode.getValueType();
                            // See API reference for complete list of supported types
                            switch (valueType) {
                                case FirebaseVisionBarcode.TYPE_DRIVER_LICENSE:
                                    info = new BarcodeInfo(barcode.getDriverLicense());
                                    storeDL(info);
                                    verifyDL(info);
                                    break;
                            }
                        }
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(@NonNull Exception e) {
                        // Task failed with an exception
                    }
                });
    }

    //stores DL data in new spot in database under type/uid
    public void storeDL(BarcodeInfo dl){

        Map<String, Object> dlInfo = new HashMap<>();
        Map<String, Object> overall = new HashMap<>();
        dlInfo.put("DLNumber", dl.licenseNumber );
        dlInfo.put("DOB", dl.birthDate);
        dlInfo.put("City", dl.city);
        dlInfo.put("MiddleName", dl.middleName);
        dlInfo.put("ExpDate", dl.expDate);
        dlInfo.put("FirstName", dl.firstName);
        dlInfo.put("Gender", dl.gender);
        dlInfo.put("IssueDate", dl.issueDate);
        dlInfo.put("IssuingCountry", dl.issuingCountry);
        dlInfo.put("State", dl.stateUS);
        dlInfo.put("LastName", dl.lastName);
        dlInfo.put("ZipCode", dl.zipcode);
        dlInfo.put("Street", dl.street);
        overall.put("DL Info", dlInfo);

        db.collection(type).document(user.getUid()).set(overall, SetOptions.merge())
                .addOnSuccessListener(new OnSuccessListener<Void>() {
                    @Override
                    public void onSuccess(Void aVoid) {

                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(@NonNull Exception e) {

                    }
                });
    }

    //Compares info from barcode to first and last name extracted from front
    public void verifyDL(BarcodeInfo dl){
        if((first.equals(dl.firstName)) && (last.equals(dl.lastName))){
            AlertDialog.Builder builder1 = new AlertDialog.Builder(this);
            builder1.setMessage("APPROVED!");
            builder1.setCancelable(true);

            builder1.setPositiveButton(
                    "Yes",
                    new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface dialog, int id) {
                            dialog.cancel();
                            if(type.equals("Tenant")){
                                Intent intent = new Intent(Driver_License_Scan.this , ConfirmationDetails.class);
                                intent.putExtra("type", type);
                                intent.putExtra("firstName", first);
                                intent.putExtra("lastName", last);
                                Driver_License_Scan.this.startActivity(intent);
                                finish();
                            }else {
                                Intent intent = new Intent(Driver_License_Scan.this, APNnumber.class);
                                intent.putExtra("type", type);
                                intent.putExtra("firstName", first);
                                intent.putExtra("lastName", last);
                                Driver_License_Scan.this.startActivity(intent);
                                finish();
                            }
                        }
                    });
            AlertDialog alert11 = builder1.create();
            alert11.show();
        }else{
            AlertDialog.Builder builder1 = new AlertDialog.Builder(this);
            builder1.setMessage("FAILED. License pictures are not from the same driver's licence. Try again?");
            builder1.setCancelable(true);

            builder1.setPositiveButton(
                    "Yes",
                    new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface dialog, int id) {
                            dialog.cancel();
                        }
                    });
            AlertDialog alert11 = builder1.create();
            alert11.show();
        }
    }

}
