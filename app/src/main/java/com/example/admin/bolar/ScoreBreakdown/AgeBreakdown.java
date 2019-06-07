package com.example.admin.bolar.ScoreBreakdown;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.ImageView;
import android.widget.TextView;

import com.example.admin.bolar.BreakdownAdapter;
import com.example.admin.bolar.BreakdownModel;
import com.example.admin.bolar.R;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QueryDocumentSnapshot;
import com.google.firebase.firestore.QuerySnapshot;

import java.util.ArrayList;
import java.util.Map;
import java.util.Objects;

public class AgeBreakdown extends AppCompatActivity {

    //public ArrayList<BreakdownModel> items;
    private String factor;
    private FirebaseFirestore db = FirebaseFirestore.getInstance();
    private FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
    public RecyclerView rvContacts;
    public TextView mainText;
    public ImageView mainImage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_age_breakdown);

        Intent intent = getIntent();
        factor = intent.getStringExtra("factor");

        rvContacts = (RecyclerView) findViewById(R.id.breakdown_recycle);
        mainImage = findViewById(R.id.breakdown_image);
        mainText = findViewById(R.id.breakdown_text);

        setTitle("Score Factor Breakdown");

        if(factor.equals("Average_Duration_History")){
            mainText.setText("Average Duration");
        }else if(factor.equals("Marks_History")){
            mainText.setText("Derogatory Marks");
            mainImage.setImageDrawable(getResources().getDrawable(R.color.fairState));
        }else if(factor.equals("Age_History")){
            mainText.setText("Your Rental History");
            mainImage.setImageDrawable(getResources().getDrawable(R.drawable.bolar_age_smallest));
        }else if(factor.equals("Payment_History")){
            mainText.setText("Your Payment History");
        }
        getData();
    }

    public void getData(){
        //TODO: replace hardcoded uid with user.getUid()
        db.collection("Tenant").document("PAt4FTo2zNX6fEfkcwhae3iJxrn1")
                .collection(factor).get()
                .addOnCompleteListener(new OnCompleteListener<QuerySnapshot>() {

                    private static final String TAG = "TAG";

                    @Override
                    public void onComplete(@NonNull Task<QuerySnapshot> task) {
                        if (task.isSuccessful()) {

                            ArrayList<BreakdownModel> data;
                            data = new ArrayList<>();
                            BreakdownAdapter adapter = new BreakdownAdapter(data, factor);
                            rvContacts.setAdapter(adapter);
                            rvContacts.setLayoutManager(new LinearLayoutManager(getBaseContext()));
                            for (QueryDocumentSnapshot document : Objects.requireNonNull(task.getResult())) {
                                Log.d(TAG, document.getId() + " => " + document.getData());
                                String address = document.getId();
                                if(document.contains("Complaint1")){
                                    Map<String,Object> map = document.getData();
                                    String data1 = String.valueOf(map.size());
                                    data.add(new BreakdownModel(address,data1,""));
                                    adapter.notifyDataSetChanged();
                                }else if(document.contains(("MoveIn"))){
                                    String data1 = document.getTimestamp("MoveIn").toDate().toString();
                                    String data2 = document.getTimestamp("MoveOut").toDate().toString();
                                    data.add(new BreakdownModel(address,data1.substring(data1.length()-5),data2.substring(data1.length()-5)));
                                    adapter.notifyDataSetChanged();
                                }else if(document.contains("Months")){
                                    String data1 = document.getDouble("Months").toString();
                                    String data2 = document.getDouble("Years").toString();
                                    data.add(new BreakdownModel(address,data1,data2));
                                    adapter.notifyDataSetChanged();
                                }else if(document.contains("MissedPayments")){
                                    String data1 = document.getDouble("OnTimePayments").toString();
                                    String data2 = document.getDouble("MissedPayments").toString();
                                    data.add(new BreakdownModel(address,data1,data2));
                                    adapter.notifyDataSetChanged();
                                }
                            }

                        } else {
                            Log.d(TAG, "get failed with ", task.getException());
                        }
                    }
                });
    }
}
